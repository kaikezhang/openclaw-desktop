import { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, ipcMain } from 'electron';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

import { OpenClawClient } from './openclaw-client';
import { TTSEngine } from './tts-engine';
import { registerIpcHandlers } from './ipc-handlers';
import { ImageGenEngine } from './image-gen';
import { initAutoUpdater } from './auto-updater';
import { getSettings } from './settings-store';
import { getOutfit, setCurrentOutfit } from './wardrobe';

// Suppress EPIPE errors when running in background
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  throw err;
});
process.stderr.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  throw err;
});

// ===== Services =====

/** Extract text from a gateway chat message object. */
function extractMessageText(message: any): string {
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

let externalChatAccumulated = '';
let externalChatSessionStarted = false;
let externalTTSLocked = false;  // Lock to prevent new events from interrupting TTS playback
let externalTTSCheckInterval: ReturnType<typeof setInterval> | null = null;
let externalTTSSafetyTimer: ReturnType<typeof setTimeout> | null = null;

function cleanupExternalTTSTimers(): void {
  if (externalTTSCheckInterval) { clearInterval(externalTTSCheckInterval); externalTTSCheckInterval = null; }
  if (externalTTSSafetyTimer) { clearTimeout(externalTTSSafetyTimer); externalTTSSafetyTimer = null; }
}

function unlockExternalTTS(reason: string): void {
  if (!externalTTSLocked) return;
  externalTTSLocked = false;
  externalChatSessionStarted = false;
  cleanupExternalTTSTimers();
  console.log(`[ExternalChat] Unlocked (${reason})`);
}

const openclawClient = new OpenClawClient({
  port: parseInt(process.env.OPENCLAW_PORT || '18789', 10),
  token: process.env.OPENCLAW_TOKEN || '',
  onEvent: (msg) => {
    // Handle external chat events (e.g. from sessions_send) → feed to TTS
    if (msg.event !== 'chat') return;
    if ((globalThis as any).__openclawLocalChatActive) return; // Local chat already handles TTS via its own stream
    if (externalTTSLocked) return; // TTS playing from previous external chat, ignore all new events

    const payload = msg.payload || {};
    const state = payload.state;

    // Auto-start TTS session on first delta — but only if TTS is idle
    // If TTS is busy (playing previous text), just append without resetting
    if ((state === 'delta' || state === 'started') && !externalChatSessionStarted) {
      externalChatSessionStarted = true;
      externalChatAccumulated = '';
      if (!ttsEngine.isBusy) {
        ttsEngine.startSession();
        console.log('[ExternalChat] TTS session started (idle)');
      } else {
        console.log('[ExternalChat] TTS busy, appending without reset');
      }
      if (mainWindow) {
        mainWindow.webContents.send('external:chatStarted');
      }
    }

    if (state === 'delta') {
      const text = extractMessageText(payload.message);
      if (text && text.length > (externalChatAccumulated?.length || 0)) {
        const delta = text.slice(externalChatAccumulated.length);
        console.log(`[ExternalChat] delta +${delta.length} chars`);
        ttsEngine.splitter.addText(delta);
        externalChatAccumulated = text;
      }
    } else if (state === 'final') {
      const text = extractMessageText(payload.message);
      if (text && text.length > (externalChatAccumulated?.length || 0)) {
        ttsEngine.splitter.addText(text.slice(externalChatAccumulated.length));
      }
      ttsEngine.splitter.finish();
      externalChatAccumulated = '';
      console.log('[ExternalChat] final, TTS flushed — locking until playback done');

      // Lock: ignore all new external chat events until BOTH:
      // 1. TTS engine finishes generating all audio chunks (isBusy === false)
      // 2. Renderer finishes playing all audio (tts:playbackDone IPC)
      externalTTSLocked = true;
      cleanupExternalTTSTimers();

      // Poll for TTS engine idle, then ping renderer to check playback state
      externalTTSCheckInterval = setInterval(() => {
        if (!ttsEngine.isBusy) {
          if (externalTTSCheckInterval) { clearInterval(externalTTSCheckInterval); externalTTSCheckInterval = null; }
          // All audio chunks sent to renderer. Ask renderer if playback is also done.
          // If renderer is still playing, it will send tts:playbackDone via onQueueEmpty later.
          mainWindow?.webContents.send('tts:checkPlayback');
        }
      }, 500);

      // Safety timeout: force unlock after 5 minutes (very long story edge case)
      externalTTSSafetyTimer = setTimeout(() => {
        unlockExternalTTS('safety timeout 5min');
      }, 5 * 60 * 1000);

      // Also show in bubble
      if (text && mainWindow) {
        mainWindow.webContents.send('external:chat', { text });
      }
    }
  },
  onOutfitChange: (event) => {
    console.log(`[App] Outfit change event: ${event.status} (${event.outfit})`);

    if (event.status === 'ready' && event.outfit) {
      // Try loading from wardrobe if sprites not in the event
      let sprites = event.sprites;
      if (!sprites) {
        sprites = getOutfit(event.outfit) || undefined;
      }
      if (sprites) {
        setCurrentOutfit(event.outfit);
      }
      mainWindow?.webContents.send('outfit:change', {
        status: 'ready',
        outfit: event.outfit,
        sprites,
      });
    } else {
      // Forward loading/error states
      mainWindow?.webContents.send('outfit:change', {
        status: event.status,
        outfit: event.outfit,
        error: event.error,
      });
    }
  },
});

const ttsEngine = new TTSEngine({
  apiKey: process.env.MINIMAX_API_KEY || '',
  groupId: process.env.MINIMAX_GROUP_ID || '',
  model: process.env.MINIMAX_MODEL || 'speech-02-hd',
  voiceId: process.env.MINIMAX_VOICE_ID || 'Chinese (Mandarin)_Warm_Girl',
});

// Apply saved voice setting (migrate from old default if needed)
{
  const settings = getSettings();
  const voice = settings.minimaxVoiceId;
  // Migrate: old default 'Lovely_Girl' → new default
  if (!voice || voice === 'Lovely_Girl') {
    const { setSettings } = require('./settings-store');
    setSettings({ minimaxVoiceId: 'Chinese (Mandarin)_Warm_Girl' });
    ttsEngine.setVoice('Chinese (Mandarin)_Warm_Girl');
  } else {
    ttsEngine.setVoice(voice);
  }
}

const imageGenEngine = new ImageGenEngine({
  falKey: process.env.FAL_KEY || '',
});

// ===== Window & Tray =====

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 330,
    height: 550,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'));

  // Pass window reference to engines
  ttsEngine.setWindow(mainWindow);

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ===== Login Item (Start with System) =====

function setLoginItem(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: ['--hidden'],
  });
}

function getLoginItem(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}

// ===== Settings Window =====

let settingsWindow: BrowserWindow | null = null;

function openSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 600,
    resizable: false,
    title: 'Settings',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ===== System Tray =====

function createTray(): void {
  // Create a simple 16x16 icon programmatically
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA' +
    'mElEQVQ4T2NkoBAwUqifgWoGMDIy/mdkZPzPwMBQwIBsEIoB////Z2RhYfnPwsJSwMjI' +
    'WIBiABMT038WFhYGFhaW/0xMTAXoBjAxMf1nZmb+z8zM/J+JiamAkZGxAMUAJiYmBmZm' +
    '5v/MzMwFjIyM/1EMYGJi+s/MzFzAyMhYgOIFJiam/8zMzAWMjIwFyM5ANYCBagYAAGGh' +
    'FhHjNJDOAAAAAElFTkSuQmCC'
  );

  tray = new Tray(icon);
  tray.setToolTip('OpenClaw Desktop');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow?.show();
          mainWindow?.focus();
        }
      },
    },
    {
      label: 'Mini Mode',
      click: () => {
        mainWindow?.webContents.send('hotkey:toggleMini');
      },
    },
    {
      label: 'Settings',
      click: () => {
        openSettingsWindow();
      },
    },
    {
      label: 'New Chat',
      click: () => {
        openclawClient.newSession();
        mainWindow?.webContents.send('session:reset');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
    }
  });
}

// ===== Global Shortcuts =====

function registerGlobalShortcuts(): void {
  // Toggle mini mode
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    mainWindow?.webContents.send('hotkey:toggleMini');
  });
}

// ===== Lifecycle =====

app.whenReady().then(() => {
  createWindow();
  createTray();
  registerGlobalShortcuts();

  // Register IPC handlers
  registerIpcHandlers({
    getWindow: () => mainWindow,
    openclawClient,
    ttsEngine,
    imageGenEngine,
    getLoginItem,
    setLoginItem,
    openSettingsWindow,
  });

  // Auto-updater (only in packaged builds)
  initAutoUpdater(() => mainWindow);

  // Renderer signals that audio playback queue is empty
  ipcMain.on('tts:playbackDone', () => {
    if (externalTTSLocked && !ttsEngine.isBusy) {
      unlockExternalTTS('renderer playback done');
    }
  });

  // Outfit change is triggered via IPC from renderer (text trigger __OUTFIT:name__)

  // Pre-connect to OpenClaw (non-blocking)
  openclawClient.connect()
    .then(() => console.log('[App] OpenClaw pre-connected'))
    .catch((err) => console.warn('[App] OpenClaw pre-connect failed (will retry on first chat):', err.message));
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  ttsEngine.stop();
  openclawClient.disconnect();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
