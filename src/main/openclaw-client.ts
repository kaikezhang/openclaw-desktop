import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import {
  type DeviceIdentity,
  loadOrCreateDeviceIdentity,
  signDevicePayload,
  buildDeviceAuthPayload,
  publicKeyRawBase64Url,
} from './device-identity';

export interface OpenClawConfig {
  port: number;
  token: string;
  onEvent?: (event: any) => void;
}

export interface ChatStreamCallbacks {
  onText: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

/**
 * OpenClaw WebSocket gateway client.
 *
 * Protocol (matches actual gateway implementation):
 *   1. Connect WebSocket to ws://localhost:{port}
 *   2. Receive `connect.challenge` event with { nonce }
 *   3. Send `connect` request with auth + nonce
 *   4. Receive response with hello payload (includes policy.tickIntervalMs)
 *   5. Send `chat.send` requests, receive streamed `chat` events
 *   6. Gateway sends periodic `tick` events for keepalive
 */
export class OpenClawClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private closed = false;
  private connectNonce: string | null = null;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: Error) => void;
  }>();
  private config: OpenClawConfig;
  private deviceIdentity: DeviceIdentity;

  // Session
  private sessionKey = 'agent:main:desktop';

  // Reconnection
  private backoffMs = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Tick keepalive
  private tickIntervalMs = 30_000;
  private lastTick: number | null = null;
  private tickWatchTimer: ReturnType<typeof setInterval> | null = null;

  // Event sequence tracking
  private lastSeq: number | null = null;

  constructor(config: OpenClawConfig) {
    this.config = config;
    this.deviceIdentity = loadOrCreateDeviceIdentity();
  }

  /** Reset the session by sending /reset to the gateway. */
  async resetSession(): Promise<string> {
    console.log(`[OpenClaw] Resetting session: ${this.sessionKey}`);
    try {
      await this.ensureConnected();
      // Send /reset as a chat message to clear session history
      const reqId = randomUUID();
      this.ws!.send(JSON.stringify({
        type: 'req',
        id: reqId,
        method: 'chat.send',
        params: {
          sessionKey: this.sessionKey,
          idempotencyKey: randomUUID(),
          message: '/reset',
        },
      }));
    } catch (e) {
      console.warn('[OpenClaw] Reset failed:', (e as Error).message);
    }
    return this.sessionKey;
  }

  // Kept for backward compat
  newSession(): string {
    this.resetSession().catch(() => {});
    return this.sessionKey;
  }

  /** Get current session key. */
  getSessionKey(): string {
    return this.sessionKey;
  }

  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  // Guard against concurrent connect calls
  private connectPromise: Promise<void> | null = null;

  /** Connect and authenticate with the OpenClaw gateway. */
  connect(): Promise<void> {
    if (this.isConnected) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.closed = false;

    const p = new Promise<void>((resolve, reject) => {
      const url = `ws://localhost:${this.config.port}`;
      console.log(`[OpenClaw] Connecting to ${url}...`);

      this.ws = new WebSocket(url, { maxPayload: 25 * 1024 * 1024 });
      this.connectNonce = null;

      const clearGuard = () => { this.connectPromise = null; };

      const timeout = setTimeout(() => {
        clearGuard();
        reject(new Error('OpenClaw connection timeout'));
        this.ws?.close();
      }, 30_000);

      let connectResolved = false;

      this.ws.on('open', () => {
        console.log('[OpenClaw] WebSocket open, waiting for challenge...');
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(msg, timeout, () => {
            if (!connectResolved) {
              connectResolved = true;
              clearGuard();
              resolve();
            }
          }, (err) => {
            if (!connectResolved) {
              connectResolved = true;
              clearGuard();
              reject(err);
            }
          });
        } catch (e) {
          console.error('[OpenClaw] Failed to parse message:', e);
        }
      });

      this.ws.on('error', (err) => {
        console.error('[OpenClaw] WebSocket error:', err.message);
      });

      this.ws.on('close', (code, reason) => {
        const reasonText = reason?.toString() || '';
        console.log(`[OpenClaw] WebSocket closed (${code}): ${reasonText}`);
        this.connected = false;
        this.ws = null;
        this.stopTickWatch();
        this.flushPendingErrors(new Error(`gateway closed (${code}): ${reasonText}`));

        if (!connectResolved) {
          connectResolved = true;
          clearGuard();
          reject(new Error(`Connection closed (${code}): ${reasonText}`));
        }

        // Auto-reconnect unless explicitly closed
        if (!this.closed) {
          this.scheduleReconnect();
        }
      });
    });
    this.connectPromise = p;
    return p;
  }

  /** Disconnect from the gateway. */
  disconnect(): void {
    this.closed = true;
    this.connectPromise = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopTickWatch();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.flushPendingErrors(new Error('client disconnected'));
  }

  /**
   * Send a chat message and stream the response.
   */
  async chat(message: string, callbacks: ChatStreamCallbacks): Promise<string> {
    await this.ensureConnected();

    const reqId = randomUUID();
    const idempotencyKey = randomUUID();
    let accumulatedText = '';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.ws?.removeListener('message', chatHandler);
        if (accumulatedText.length > 0) {
          console.log('[OpenClaw] Chat timeout, returning partial text');
          callbacks.onDone(accumulatedText);
          resolve(accumulatedText);
        } else {
          const err = new Error('OpenClaw chat timeout');
          callbacks.onError(err);
          reject(err);
        }
      }, 180_000);

      const chatHandler = (raw: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(raw.toString());

          // Handle chat.send rejection
          if (msg.type === 'res' && msg.id === reqId && !msg.ok) {
            this.ws?.removeListener('message', chatHandler);
            clearTimeout(timeout);
            const err = new Error(msg.error?.message || 'chat.send rejected');
            callbacks.onError(err);
            reject(err);
            return;
          }

          // Handle streamed chat events
          if (msg.type === 'event' && msg.event === 'chat') {
            const payload = msg.payload || {};

            if (payload.state === 'delta') {
              // payload.message.content is the full accumulated text so far
              const newText = this.extractMessageText(payload.message);
              if (newText && newText.length > accumulatedText.length) {
                const delta = newText.slice(accumulatedText.length);
                accumulatedText = newText;
                callbacks.onText(delta);
              }
            } else if (payload.state === 'final') {
              // Final state — extract final text if available
              const finalText = this.extractMessageText(payload.message);
              if (finalText && finalText.length > accumulatedText.length) {
                const delta = finalText.slice(accumulatedText.length);
                callbacks.onText(delta);
                accumulatedText = finalText;
              }
              this.ws?.removeListener('message', chatHandler);
              clearTimeout(timeout);
              callbacks.onDone(accumulatedText);
              resolve(accumulatedText);
            } else if (payload.state === 'error' || payload.state === 'aborted') {
              this.ws?.removeListener('message', chatHandler);
              clearTimeout(timeout);
              if (accumulatedText.length > 0) {
                callbacks.onDone(accumulatedText);
                resolve(accumulatedText);
              } else {
                const err = new Error(payload.errorMessage || `Chat ${payload.state}`);
                callbacks.onError(err);
                reject(err);
              }
            }
          }
        } catch (_) {
          // Ignore parse errors in chat handler
        }
      };

      this.ws!.on('message', chatHandler);

      this.ws!.send(JSON.stringify({
        type: 'req',
        id: reqId,
        method: 'chat.send',
        params: {
          sessionKey: this.sessionKey,
          idempotencyKey,
          message,
        },
      }));
    });
  }

  /** Send an arbitrary request to the gateway. */
  async request(method: string, params: Record<string, any> = {}): Promise<any> {
    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      const id = randomUUID();
      this.pendingRequests.set(id, { resolve, reject });

      this.ws!.send(JSON.stringify({ type: 'req', id, method, params }));

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30_000);
    });
  }

  /**
   * Extract text from a gateway chat message object.
   * message.content can be a string or an array of content blocks.
   */
  private extractMessageText(message: any): string {
    if (!message) return '';
    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
        .map((block: any) => block.text)
        .join('\n');
    }
    return '';
  }

  // ---- Internal ----

  private async ensureConnected(): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
  }

  // sendConnect removed — use sendConnectWithCallback instead

  private handleMessage(
    msg: any,
    connectTimeout: ReturnType<typeof setTimeout>,
    connectResolve: () => void,
    _connectReject: (err: Error) => void,
  ): void {
    // Connection challenge → store nonce and send auth
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      const nonce = msg.payload?.nonce;
      if (typeof nonce === 'string') {
        this.connectNonce = nonce;
      }
      console.log('[OpenClaw] Got challenge, authenticating...');
      this.sendConnectWithCallback(connectTimeout, connectResolve, _connectReject);
      return;
    }

    // Tick keepalive
    if (msg.type === 'event' && msg.event === 'tick') {
      this.lastTick = Date.now();
      return;
    }

    // Track event sequence
    if (msg.type === 'event' && typeof msg.seq === 'number') {
      if (this.lastSeq !== null && msg.seq > this.lastSeq + 1) {
        console.warn(`[OpenClaw] Event gap: expected seq ${this.lastSeq + 1}, got ${msg.seq}`);
      }
      this.lastSeq = msg.seq;
    }

    // Forward all events to callback
    if (msg.type === 'event') {
      this.config.onEvent?.(msg);
    }

    // Route responses to pending requests
    if (msg.type === 'res') {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.payload);
        } else {
          pending.reject(new Error(msg.error?.message || 'Request failed'));
        }
      }
    }
  }

  private sendConnectWithCallback(
    connectTimeout: ReturnType<typeof setTimeout>,
    connectResolve: () => void,
    connectReject: (err: Error) => void,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const connectId = randomUUID();

    this.pendingRequests.set(connectId, {
      resolve: (payload: any) => {
        clearTimeout(connectTimeout);
        this.connected = true;
        this.backoffMs = 1000;

        if (typeof payload?.policy?.tickIntervalMs === 'number') {
          this.tickIntervalMs = payload.policy.tickIntervalMs;
        }
        this.lastTick = Date.now();
        this.startTickWatch();

        console.log(`[OpenClaw] Authenticated (tickInterval=${this.tickIntervalMs}ms)`);
        connectResolve();
      },
      reject: (err: Error) => {
        clearTimeout(connectTimeout);
        console.error('[OpenClaw] Auth failed:', err.message);
        connectReject(err);
        this.ws?.close(1008, 'connect failed');
      },
    });

    const role = 'operator';
    const scopes = ['operator.admin'];
    const signedAtMs = Date.now();
    const nonce = this.connectNonce ?? undefined;
    const authToken = this.config.token || undefined;

    const authPayload = buildDeviceAuthPayload({
      deviceId: this.deviceIdentity.deviceId,
      clientId: 'gateway-client',
      clientMode: 'backend',
      role,
      scopes,
      signedAtMs,
      token: authToken ?? null,
      nonce,
    });
    const signature = signDevicePayload(this.deviceIdentity.privateKeyPem, authPayload);

    this.ws.send(JSON.stringify({
      type: 'req',
      id: connectId,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'gateway-client',
          version: '0.2.0',
          platform: 'electron',
          mode: 'backend',
        },
        role,
        scopes,
        auth: authToken ? { token: authToken } : undefined,
        device: {
          id: this.deviceIdentity.deviceId,
          publicKey: publicKeyRawBase64Url(this.deviceIdentity.publicKeyPem),
          signature,
          signedAt: signedAtMs,
          ...(nonce ? { nonce } : {}),
        },
      },
    }));
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    console.log(`[OpenClaw] Reconnecting in ${delay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[OpenClaw] Reconnect failed:', err.message);
      });
    }, delay);
  }

  private startTickWatch(): void {
    this.stopTickWatch();
    const interval = Math.max(this.tickIntervalMs, 1000);
    this.tickWatchTimer = setInterval(() => {
      if (this.closed || !this.lastTick) return;
      if (Date.now() - this.lastTick > this.tickIntervalMs * 2) {
        console.warn('[OpenClaw] Tick timeout, closing connection');
        this.ws?.close(4000, 'tick timeout');
      }
    }, interval);
  }

  private stopTickWatch(): void {
    if (this.tickWatchTimer) {
      clearInterval(this.tickWatchTimer);
      this.tickWatchTimer = null;
    }
  }

  private flushPendingErrors(err: Error): void {
    for (const [, p] of this.pendingRequests) {
      p.reject(err);
    }
    this.pendingRequests.clear();
  }
}
