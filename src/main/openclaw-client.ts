import WebSocket from 'ws';

export interface OpenClawConfig {
  port: number;
  token: string;
}

export interface ChatStreamCallbacks {
  onText: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

/**
 * OpenClaw WebSocket gateway client.
 *
 * Protocol flow:
 *   1. Connect → receive `connect.challenge` event
 *   2. Send `connect` request with auth token
 *   3. Send `chat.send` requests, receive streamed `chat` events
 */
export class OpenClawClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: Error) => void;
  }>();
  private config: OpenClawConfig;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: OpenClawConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Connect and authenticate with the OpenClaw gateway. */
  connect(): Promise<void> {
    if (this.isConnected) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const url = `ws://localhost:${this.config.port}`;
      console.log(`[OpenClaw] Connecting to ${url}...`);

      this.ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        reject(new Error('OpenClaw connection timeout'));
      }, 10_000);

      this.ws.on('open', () => {
        console.log('[OpenClaw] WebSocket open, waiting for challenge...');
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(msg, timeout, resolve, reject);
        } catch (e) {
          console.error('[OpenClaw] Failed to parse message:', e);
        }
      });

      this.ws.on('error', (err) => {
        console.error('[OpenClaw] WebSocket error:', err.message);
        this.connected = false;
      });

      this.ws.on('close', () => {
        console.log('[OpenClaw] WebSocket closed');
        this.connected = false;
        this.ws = null;
      });
    });
  }

  /** Disconnect from the gateway. */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
  }

  /**
   * Send a chat message and stream the response.
   * Returns the full accumulated text when the stream completes.
   */
  async chat(message: string, callbacks: ChatStreamCallbacks): Promise<string> {
    await this.ensureConnected();

    const reqId = `chat-${++this.requestId}`;
    const idempotencyKey = `openclaw-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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

            if (payload.text) {
              accumulatedText += payload.text;
              callbacks.onText(payload.text);
            }

            if (payload.state === 'final' || payload.done === true) {
              this.ws?.removeListener('message', chatHandler);
              clearTimeout(timeout);
              callbacks.onDone(accumulatedText);
              resolve(accumulatedText);
            }
          }

          // Try to extract text from other events
          if (msg.type === 'event' && msg.event !== 'chat' && msg.event !== 'connect.challenge') {
            const payload = msg.payload || {};
            if (payload.text && typeof payload.text === 'string') {
              accumulatedText += payload.text;
              callbacks.onText(payload.text);
            }
          }
        } catch (_) {
          // Ignore parse errors
        }
      };

      this.ws!.on('message', chatHandler);

      this.ws!.send(JSON.stringify({
        type: 'req',
        id: reqId,
        method: 'chat.send',
        params: {
          sessionKey: 'agent:main:main',
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
      const id = `req-${++this.requestId}`;
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

  // ---- Internal ----

  private async ensureConnected(): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
  }

  private handleMessage(
    msg: any,
    connectTimeout: ReturnType<typeof setTimeout>,
    connectResolve: () => void,
    connectReject: (err: Error) => void,
  ): void {
    // Connection challenge → send auth
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      console.log('[OpenClaw] Got challenge, authenticating...');
      this.ws!.send(JSON.stringify({
        type: 'req',
        id: 'connect-1',
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: { id: 'openclaw-desktop', version: '0.2.0', platform: 'electron', mode: 'backend' },
          role: 'operator',
          scopes: ['operator.read', 'operator.write'],
          auth: { token: this.config.token },
        },
      }));
    }

    // Connection auth response
    if (msg.type === 'res' && msg.id === 'connect-1') {
      clearTimeout(connectTimeout);
      if (msg.ok) {
        this.connected = true;
        console.log('[OpenClaw] Authenticated');
        connectResolve();
      } else {
        connectReject(new Error(msg.error?.message || 'Auth failed'));
      }
    }

    // Route other responses to pending requests
    if (msg.type === 'res' && msg.id !== 'connect-1') {
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
}
