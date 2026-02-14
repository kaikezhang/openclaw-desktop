/**
 * Audio playback queue for streamed TTS chunks.
 * Plays base64-encoded mp3 segments sequentially.
 */
class AudioPlayerQueue {
  constructor() {
    this.queue = [];
    this.playing = false;
    this.currentAudio = null;
    this.textBuffer = '';
    this.onPlayStart = null;  // (text: string) => void
    this.onQueueEmpty = null; // () => void
  }

  /** Add an audio chunk to the queue. */
  enqueue(audioBase64, text) {
    this.queue.push({ audio: audioBase64, text });
    if (!this.playing) {
      this._processQueue();
    }
  }

  /** Stop playback and clear queue. */
  stop() {
    if (this.currentAudio) {
      try {
        this.currentAudio.onended = null;
        this.currentAudio.pause();
      } catch (_) {}
      this.currentAudio = null;
    }
    this.queue = [];
    this.playing = false;
    this.textBuffer = '';
  }

  /** Reset state for a new session. */
  reset() {
    this.stop();
  }

  async _processQueue() {
    if (this.playing || this.queue.length === 0) return;
    this.playing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      await this._playChunk(item.audio, item.text);
    }

    this.playing = false;

    if (this.onQueueEmpty) {
      this.onQueueEmpty();
    }
  }

  _playChunk(audioBase64, text) {
    return new Promise((resolve) => {
      const audio = new Audio('data:audio/mp3;base64,' + audioBase64);
      this.currentAudio = audio;

      audio.onplay = () => {
        // Accumulate displayed text
        if (this.textBuffer && !this.textBuffer.includes(text)) {
          this.textBuffer += text;
        } else if (!this.textBuffer) {
          this.textBuffer = text;
        }
        if (this.onPlayStart) {
          this.onPlayStart(this.textBuffer);
        }
      };

      audio.onended = () => {
        this.currentAudio = null;
        resolve();
      };

      audio.onerror = () => {
        this.currentAudio = null;
        resolve();
      };

      audio.play().catch(() => {
        this.currentAudio = null;
        resolve();
      });
    });
  }
}

window.AudioPlayerQueue = AudioPlayerQueue;
