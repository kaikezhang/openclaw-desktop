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

    // Audio analyser for visualization
    this.audioContext = null;
    this.analyser = null;
    this.frequencyData = null;
  }

  /** Get current frequency data (0-255 per bin). Returns null if not playing. */
  getFrequencyData() {
    if (!this.analyser || !this.frequencyData) return null;
    this.analyser.getByteFrequencyData(this.frequencyData);
    return this.frequencyData;
  }

  /** Get average volume level (0-1). */
  getVolume() {
    const data = this.getFrequencyData();
    if (!data) return 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return sum / (data.length * 255);
  }

  _ensureAudioContext() {
    if (this.audioContext) return;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 64;
    this.analyser.smoothingTimeConstant = 0.8;
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
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

      // Connect to analyser for visualization
      try {
        this._ensureAudioContext();
        const source = this.audioContext.createMediaElementSource(audio);
        source.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);
      } catch (e) {
        // Fallback: play without analyser (e.g. CORS issues)
      }

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
