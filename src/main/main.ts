import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

import { OpenClawClient } from './openclaw-client';
import { TTSEngine } from './tts-engine';
import { STTEngine } from './stt-engine';
import { registerIpcHandlers } from './ipc-handlers';

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
  voiceId: process.env.MINIMAX_VOICE_ID || 'Lovely_Girl',
});

const sttEngine = new STTEngine({
  apiKey: process.env.DEEPGRAM_API_KEY || '',
});

// ===== Window =====

let mainWindow: BrowserWindow | null = null;

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

// ===== Lifecycle =====

app.whenReady().then(() => {
  createWindow();

  // Register IPC handlers
  registerIpcHandlers({
    getWindow: () => mainWindow,
    openclawClient,
    ttsEngine,
    sttEngine,
  });

  // Pre-connect to OpenClaw (non-blocking)
  openclawClient.connect()
    .then(() => console.log('[App] OpenClaw pre-connected'))
    .catch((err) => console.warn('[App] OpenClaw pre-connect failed (will retry on first chat):', err.message));
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
