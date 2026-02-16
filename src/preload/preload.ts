import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload bridge — exposes a structured API to the renderer.
 * All IPC communication goes through here for security.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ===== OpenClaw Chat & Status =====
  chat: (message: string) => ipcRenderer.invoke('openclaw:chat', message),
  getConnectionStatus: () => ipcRenderer.invoke('openclaw:status'),
  newSession: () => ipcRenderer.invoke('openclaw:newSession'),

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

    notifyPlaybackDone: () => ipcRenderer.send('tts:playbackDone'),
    onCheckPlayback: (cb: () => void) =>
      ipcRenderer.on('tts:checkPlayback', () => cb()),

    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('tts:audioChunk');
      ipcRenderer.removeAllListeners('tts:firstSentence');
      ipcRenderer.removeAllListeners('tts:checkPlayback');
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

  // ===== Image Generation =====
  image: {
    generateSelfie: (promptOrOpts: string | { prompt: string; outfitDescription?: string }) => ipcRenderer.invoke('image:generateSelfie', promptOrOpts),
  },

  // ===== Settings =====
  settings: {
    open: () => ipcRenderer.invoke('settings:open'),
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, any>) => ipcRenderer.invoke('settings:set', patch),
    getLoginItem: () => ipcRenderer.invoke('settings:getLoginItem'),
    setLoginItem: (enabled: boolean) => ipcRenderer.invoke('settings:setLoginItem', enabled),
  },

  // ===== Notifications =====
  notify: (title: string, body: string) => ipcRenderer.invoke('notify', { title, body }),

  // ===== Outfit Change =====
  onOutfitChange: (cb: (data: {
    status: 'loading' | 'ready' | 'error';
    outfit: string;
    sprites?: { idle: string; blink: string; speaking: string };
    error?: string;
  }) => void) =>
    ipcRenderer.on('outfit:change', (_e, data) => cb(data)),
  loadOutfit: (name: string) => ipcRenderer.invoke('outfit:load', name),
  requestOutfit: (description: string) => ipcRenderer.invoke('outfit:request', description),
  notifyOutfitChanged: (description: string) => ipcRenderer.invoke('outfit:notifyChanged', description),
  listOutfits: () => ipcRenderer.invoke('outfit:list'),
  getOutfitThumbnail: (name: string) => ipcRenderer.invoke('outfit:thumbnail', name),

  // ===== External Chat (from sessions_send) =====
  onExternalChat: (cb: (data: { text: string }) => void) =>
    ipcRenderer.on('external:chat', (_e, data) => cb(data)),
  onExternalChatStarted: (cb: () => void) =>
    ipcRenderer.on('external:chatStarted', () => cb()),

  // ===== Global Hotkeys =====
  onToggleMini: (cb: () => void) =>
    ipcRenderer.on('hotkey:toggleMini', () => cb()),
  onSessionReset: (cb: () => void) =>
    ipcRenderer.on('session:reset', () => cb()),

  // ===== Auto-Updater =====
  updater: {
    onAvailable: (cb: (data: { version: string }) => void) =>
      ipcRenderer.on('updater:available', (_e, data) => cb(data)),
    onProgress: (cb: (data: { percent: number }) => void) =>
      ipcRenderer.on('updater:progress', (_e, data) => cb(data)),
    onDownloaded: (cb: (data: { version: string }) => void) =>
      ipcRenderer.on('updater:downloaded', (_e, data) => cb(data)),
  },
});
