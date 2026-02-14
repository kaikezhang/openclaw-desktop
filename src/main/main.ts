import { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage } from 'electron';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

import { OpenClawClient } from './openclaw-client';
import { TTSEngine } from './tts-engine';
import { STTEngine } from './stt-engine';
import { registerIpcHandlers } from './ipc-handlers';
import { ImageGenEngine } from './image-gen';
import { initAutoUpdater } from './auto-updater';

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

const openclawClient = new OpenClawClient({
  port: parseInt(process.env.OPENCLAW_PORT || '18789', 10),
  token: process.env.OPENCLAW_TOKEN || '',
});

const ttsEngine = new TTSEngine({
  apiKey: process.env.MINIMAX_API_KEY || '',
  groupId: process.env.MINIMAX_GROUP_ID || '',
  model: process.env.MINIMAX_MODEL || 'speech-02-hd',
  voiceId: process.env.MINIMAX_VOICE_ID || 'Chinese (Mandarin)_Warm_Girl',
});

const sttEngine = new STTEngine({
  apiKey: process.env.DEEPGRAM_API_KEY || '',
});

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
  sttEngine.setWindow(mainWindow);

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
  // Toggle recording (push-to-talk)
  globalShortcut.register('CommandOrControl+Shift+O', () => {
    mainWindow?.webContents.send('hotkey:toggleRecord');
  });

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
    sttEngine,
    imageGenEngine,
    getLoginItem,
    setLoginItem,
  });

  // Auto-updater (only in packaged builds)
  initAutoUpdater(() => mainWindow);

  // Pre-connect to OpenClaw (non-blocking)
  openclawClient.connect()
    .then(() => console.log('[App] OpenClaw pre-connected'))
    .catch((err) => console.warn('[App] OpenClaw pre-connect failed (will retry on first chat):', err.message));
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  sttEngine.destroy();
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
