import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload bridge — exposes a structured API to the renderer.
 * All IPC communication goes through here for security.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ===== OpenClaw Chat =====
  chat: (message: string) => ipcRenderer.invoke('openclaw:chat', message),

  // ===== STT (Speech-to-Text) =====
  stt: {
    startListening: () => ipcRenderer.invoke('stt:startListening'),
    stopListening: () => ipcRenderer.invoke('stt:stopListening'),
    sendAudio: (data: Uint8Array) => ipcRenderer.invoke('stt:sendAudio', data),

    onConnected: (cb: () => void) =>
      ipcRenderer.on('stt:connected', () => cb()),
    onTranscript: (cb: (data: { transcript: string; isFinal: boolean }) => void) =>
      ipcRenderer.on('stt:transcript', (_e, data) => cb(data)),
    onUtteranceEnd: (cb: () => void) =>
      ipcRenderer.on('stt:utteranceEnd', () => cb()),
    onError: (cb: (error: string) => void) =>
      ipcRenderer.on('stt:error', (_e, error) => cb(error)),
    onClosed: (cb: () => void) =>
      ipcRenderer.on('stt:closed', () => cb()),

    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('stt:connected');
      ipcRenderer.removeAllListeners('stt:transcript');
      ipcRenderer.removeAllListeners('stt:utteranceEnd');
      ipcRenderer.removeAllListeners('stt:error');
      ipcRenderer.removeAllListeners('stt:closed');
    },
  },

  // ===== TTS (Text-to-Speech) =====
  tts: {
    synthesize: (text: string) => ipcRenderer.invoke('tts:synthesize', text),
    setVoice: (voiceId: string) => ipcRenderer.invoke('tts:setVoice', voiceId),
    getVoice: () => ipcRenderer.invoke('tts:getVoice'),
    stop: () => ipcRenderer.invoke('tts:stop'),

    onAudioChunk: (cb: (data: {
      sentenceId: number;
      audio: string;
      text: string;
      isLast: boolean;
    }) => void) =>
      ipcRenderer.on('tts:audioChunk', (_e, data) => cb(data)),
    onFirstSentence: (cb: (data: { text: string }) => void) =>
      ipcRenderer.on('tts:firstSentence', (_e, data) => cb(data)),

    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('tts:audioChunk');
      ipcRenderer.removeAllListeners('tts:firstSentence');
    },
  },

  // ===== Window Controls =====
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  restoreWindow: () => ipcRenderer.send('window:restore'),
  closeWindow: () => ipcRenderer.send('window:close'),
  onMiniMode: (cb: (isMini: boolean) => void) =>
    ipcRenderer.on('window:miniMode', (_e, isMini) => cb(isMini)),

  // ===== File Operations =====
  file: {
    showInFolder: (filePath: string) => ipcRenderer.invoke('file:showInFolder', filePath),
  },

  // ===== Settings =====
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, any>) => ipcRenderer.invoke('settings:set', patch),
  },

  // ===== Global Hotkeys =====
  onToggleRecord: (cb: () => void) =>
    ipcRenderer.on('hotkey:toggleRecord', () => cb()),
  onToggleMini: (cb: () => void) =>
    ipcRenderer.on('hotkey:toggleMini', () => cb()),
});
