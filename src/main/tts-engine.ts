import { BrowserWindow } from 'electron';

// ===== Sentence Splitter =====

export class SentenceSplitter {
  private buffer = '';
  private onSentence: (sentence: string) => void;
  private static readonly ENDERS = /[。！？.!?]\s*/g;

  constructor(onSentence: (sentence: string) => void) {
    this.onSentence = onSentence;
  }

  addText(text: string): void {
    this.buffer += text;
    this.flush();
  }

  /** Extract complete sentences from buffer. */
  private flush(): void {
    const regex = new RegExp(SentenceSplitter.ENDERS.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(this.buffer)) !== null) {
      const endIndex = match.index + match[0].length;
      const sentence = this.buffer.substring(0, endIndex).trim();
      this.buffer = this.buffer.substring(endIndex);

      if (sentence.length > 0) {
        this.onSentence(sentence);
      }
    }
  }

  /** Flush remaining buffer (call when stream ends). */
  finish(): void {
    if (this.buffer.trim().length > 0) {
      this.onSentence(this.buffer.trim());
      this.buffer = '';
    }
  }

  reset(): void {
    this.buffer = '';
  }
}

// ===== TTS Queue Manager =====

export interface TTSConfig {
  apiKey: string;
  groupId: string;
  model: string;
  voiceId: string;
}

export class TTSEngine {
  private config: TTSConfig;
  private queue: Array<{ sentence: string; sentenceId: number }> = [];
  private processing = false;
  private sentenceCounter = 0;
  private stopped = false;
  private window: BrowserWindow | null = null;
  public splitter: SentenceSplitter;

  constructor(config: TTSConfig) {
    this.config = config;
    this.splitter = new SentenceSplitter((sentence) => {
      this.enqueueSentence(sentence);
    });
  }

  setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  get voiceId(): string {
    return this.config.voiceId;
  }

  setVoice(voiceId: string): void {
    console.log(`[TTS] Voice changed: ${this.config.voiceId} -> ${voiceId}`);
    this.config.voiceId = voiceId;
  }

  /** Start a new streaming session. */
  startSession(): void {
    this.queue = [];
    this.processing = false;
    this.sentenceCounter = 0;
    this.stopped = false;
    this.splitter.reset();
  }

  /** Stop current session and clear queue. */
  stop(): void {
    this.stopped = true;
    this.queue = [];
    this.processing = false;
    this.splitter.reset();
  }

  /** Enqueue a sentence for TTS generation. */
  private enqueueSentence(sentence: string): void {
    if (this.stopped) return;
    if (!sentence || !sentence.trim()) return;

    const sentenceId = ++this.sentenceCounter;
    console.log(`[TTS] Enqueue #${sentenceId}: "${sentence.substring(0, 40)}..."`);

    // Notify renderer of first sentence
    if (sentenceId === 1) {
      this.send('tts:firstSentence', { text: sentence });
    }

    this.queue.push({ sentence, sentenceId });
    if (!this.processing) {
      this.processQueue();
    }
  }

  /** Process queued sentences sequentially. */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0 && !this.stopped) {
      const item = this.queue.shift()!;
      try {
        const audioBase64 = await this.callMiniMaxTTS(item.sentence);
        if (audioBase64) {
          this.send('tts:audioChunk', {
            sentenceId: item.sentenceId,
            audio: audioBase64,
            text: item.sentence,
            isLast: this.queue.length === 0,
          });
        }
      } catch (error) {
        console.error(`[TTS] Sentence #${item.sentenceId} failed:`, error);
      }
    }

    this.processing = false;
  }

  /** Generate speech for a single text (non-streaming, for simple prompts). */
  async synthesize(text: string): Promise<string | null> {
    try {
      return await this.callMiniMaxTTS(text);
    } catch (error) {
      console.error('[TTS] Synthesize failed:', error);
      return null;
    }
  }

  /** Call MiniMax TTS API — returns base64 audio or throws. */
  private async callMiniMaxTTS(text: string): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('MiniMax API Key not configured');
    }

    // Skip empty or whitespace-only text
    if (!text || !text.trim()) {
      console.log('[TTS] Skipping empty text');
      return '';
    }

    console.log(`[TTS] MiniMax generating (voice: ${this.config.voiceId}): "${text.substring(0, 50)}..."`);

    // GroupId is optional for t2a_v2 API
    const url = this.config.groupId
      ? `https://api.minimax.io/v1/t2a_v2?GroupId=${this.config.groupId}`
      : 'https://api.minimax.io/v1/t2a_v2';

    const response = await fetch(url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          text,
          stream: false,
          voice_setting: {
            voice_id: this.config.voiceId,
            speed: 1.0,
            vol: 1.0,
            pitch: 0,
          },
          audio_setting: {
            sample_rate: 32000,
            format: 'mp3',
            bitrate: 128000,
          },
          language_boost: 'Chinese',
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax API ${response.status}: ${errorText}`);
    }

    const data: any = await response.json();

    if (data.base_resp?.status_code !== 0) {
      throw new Error(data.base_resp?.status_msg || 'MiniMax returned error');
    }

    if (!data.data?.audio) {
      throw new Error('No audio data in response');
    }

    // MiniMax returns hex-encoded audio — convert to base64
    const audioBuffer = Buffer.from(data.data.audio, 'hex');
    console.log(`[TTS] Audio generated: ${audioBuffer.length} bytes`);

    if (audioBuffer.length < 100) {
      throw new Error('TTS audio data too small');
    }

    return audioBuffer.toString('base64');
  }

  private send(channel: string, data: any): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, data);
    }
  }
}
