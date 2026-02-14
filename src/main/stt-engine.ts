import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import type { BrowserWindow } from 'electron';

export interface STTConfig {
  apiKey: string;
}

/**
 * Deepgram STT engine with keep-alive connection management.
 *
 * The connection stays open between listening sessions to reduce latency.
 * `activate()` / `deactivate()` toggle whether transcripts are forwarded.
 */
export class STTEngine {
  private config: STTConfig;
  private client: ReturnType<typeof createClient> | null = null;
  private live: any = null; // Deepgram live transcription connection
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private window: BrowserWindow | null = null;

  constructor(config: STTConfig) {
    this.config = config;
  }

  setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Start listening — creates connection if needed, activates transcript forwarding. */
  async startListening(): Promise<{ success: boolean; error?: string }> {
    if (!this.config.apiKey || this.config.apiKey === 'your_deepgram_api_key_here') {
      return { success: false, error: 'DEEPGRAM_API_KEY not configured' };
    }

    // Reuse existing open connection
    if (this.live) {
      try {
        const readyState = this.live.getReadyState();
        if (readyState === 1) {
          console.log('[STT] Reusing existing connection');
          this.active = true;
          return { success: true };
        }
      } catch (_) {
        // Connection broken — will recreate
      }
      this.cleanup();
    }

    try {
      this.client = createClient(this.config.apiKey);
      console.log('[STT] Opening Deepgram connection...');

      this.live = this.client.listen.live({
        model: 'nova-2',
        language: 'zh-CN',
        smart_format: true,
        interim_results: true,
        utterance_end_ms: 1200,
        vad_events: true,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
        endpointing: 300,
      });

      await this.setupListeners();
      this.active = true;
      return { success: true };
    } catch (error: any) {
      console.error('[STT] Failed to start:', error);
      return { success: false, error: error.message };
    }
  }

  /** Stop forwarding transcripts (keeps connection alive). */
  stopListening(): void {
    this.active = false;
    console.log('[STT] Deactivated (connection kept alive)');
  }

  /** Send audio data to Deepgram. */
  sendAudio(audioData: Uint8Array): void {
    if (!this.active || !this.live) return;

    try {
      const readyState = this.live.getReadyState();
      if (readyState === 1) {
        this.live.send(Buffer.from(audioData));
      }
    } catch (_) {
      // Ignore send errors
    }
  }

  /** Fully close the connection. */
  destroy(): void {
    this.active = false;
    this.cleanup();
  }

  // ---- Internal ----

  private setupListeners(): Promise<void> {
    return new Promise<void>((resolve) => {
      const connectTimeout = setTimeout(() => {
        if (this.live) {
          try {
            const rs = this.live.getReadyState();
            if (rs !== 1) {
              console.error(`[STT] Connection timeout (readyState=${rs})`);
              this.send('stt:error', 'Deepgram connection timeout');
              this.cleanup();
            }
          } catch (_) {}
        }
      }, 10_000);

      this.live.on(LiveTranscriptionEvents.Open, () => {
        clearTimeout(connectTimeout);
        console.log('[STT] Connected');

        // Keep-alive heartbeat every 8s
        this.keepAliveInterval = setInterval(() => {
          try { this.live?.keepAlive(); } catch (_) {}
        }, 8_000);

        this.send('stt:connected', null);
        resolve();
      });

      this.live.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        if (!this.active) return;

        const alt = data?.channel?.alternatives?.[0];
        if (!alt) return;

        const transcript = alt.transcript;
        const isFinal = data.is_final;

        if (transcript && transcript.trim().length > 0) {
          console.log(`[STT] ${isFinal ? 'FINAL' : 'interim'}: "${transcript}"`);
          this.send('stt:transcript', { transcript, isFinal });
        }
      });

      this.live.on(LiveTranscriptionEvents.UtteranceEnd, () => {
        if (!this.active) return;
        console.log('[STT] Utterance end');
        this.send('stt:utteranceEnd', null);
      });

      this.live.on(LiveTranscriptionEvents.Error, (error: any) => {
        clearTimeout(connectTimeout);
        console.error('[STT] Error:', error);
        this.send('stt:error', error?.message || String(error));
      });

      this.live.on(LiveTranscriptionEvents.Close, () => {
        clearTimeout(connectTimeout);
        console.log('[STT] Connection closed');
        this.active = false;
        this.cleanupKeepAlive();
        this.send('stt:closed', null);
      });
    });
  }

  private cleanup(): void {
    this.cleanupKeepAlive();
    if (this.live) {
      try { this.live.finish(); } catch (_) {}
      this.live = null;
    }
  }

  private cleanupKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  private send(channel: string, data: any): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, data);
    }
  }
}
