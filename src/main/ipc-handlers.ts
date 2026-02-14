import { ipcMain, shell, Notification, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import { OpenClawClient } from './openclaw-client';
import { TTSEngine } from './tts-engine';
import { STTEngine } from './stt-engine';

/**
 * Register all IPC handlers.
 * Wires the renderer ↔ main process communication.
 */
export function registerIpcHandlers(deps: {
  getWindow: () => BrowserWindow | null;
  openclawClient: OpenClawClient;
  ttsEngine: TTSEngine;
  sttEngine: STTEngine;
}): void {
  const { getWindow, openclawClient, ttsEngine, sttEngine } = deps;

  // ===== Chat =====

  ipcMain.handle('openclaw:chat', async (_event, message: string) => {
    console.log('[IPC] openclaw:chat:', message);

    // Reset TTS for new streaming session
    ttsEngine.startSession();

    try {
      const reply = await openclawClient.chat(message, {
        onText: (text) => {
          ttsEngine.splitter.addText(text);
        },
        onDone: (_fullText) => {
          ttsEngine.splitter.finish();
        },
        onError: (err) => {
          console.error('[IPC] Chat stream error:', err.message);
        },
      });

      return { success: true, message: reply };
    } catch (error: any) {
      console.error('[IPC] Chat failed:', error.message);
      return {
        success: false,
        message: 'OpenClaw gateway not reachable. Make sure the service is running.',
      };
    }
  });

  // ===== STT =====

  ipcMain.handle('stt:startListening', async () => {
    return sttEngine.startListening();
  });

  ipcMain.handle('stt:stopListening', async () => {
    sttEngine.stopListening();
    return { success: true };
  });

  ipcMain.handle('stt:sendAudio', async (_event, audioData: Uint8Array) => {
    sttEngine.sendAudio(audioData);
    return { success: true };
  });

  // ===== TTS =====

  ipcMain.handle('tts:synthesize', async (_event, text: string) => {
    try {
      const audio = await ttsEngine.synthesize(text);
      if (audio) {
        return { success: true, audio };
      }
      return { success: false, error: 'No audio generated' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('tts:setVoice', async (_event, voiceId: string) => {
    ttsEngine.setVoice(voiceId);
    return { success: true };
  });

  ipcMain.handle('tts:getVoice', async () => {
    return { voiceId: ttsEngine.voiceId };
  });

  ipcMain.handle('tts:stop', async () => {
    ttsEngine.stop();
    return { success: true };
  });

  // ===== Window Controls =====

  const FULL_WIDTH = 330;
  const FULL_HEIGHT = 550;
  const MINI_SIZE = 64;
  let restorePos: { x: number; y: number } | null = null;

  ipcMain.on('window:minimize', () => {
    const win = getWindow();
    if (!win) return;

    const bounds = win.getBounds();
    restorePos = { x: bounds.x, y: bounds.y };

    win.setMinimumSize(MINI_SIZE, MINI_SIZE);
    win.setSize(MINI_SIZE, MINI_SIZE);

    const { screen } = require('electron');
    const display = screen.getPrimaryDisplay();
    const x = display.workArea.x + display.workArea.width - MINI_SIZE - 20;
    const y = display.workArea.y + display.workArea.height - MINI_SIZE - 20;
    win.setPosition(x, y);
    win.webContents.send('window:miniMode', true);
  });

  ipcMain.on('window:restore', () => {
    const win = getWindow();
    if (!win) return;

    win.setMinimumSize(200, 300);
    win.setSize(FULL_WIDTH, FULL_HEIGHT);

    if (restorePos) {
      win.setPosition(restorePos.x, restorePos.y);
      restorePos = null;
    } else {
      win.center();
    }

    win.webContents.send('window:miniMode', false);
  });

  ipcMain.on('window:close', () => {
    getWindow()?.close();
  });

  // ===== File Operations =====

  ipcMain.handle('file:showInFolder', async (_event, filePath: string) => {
    try {
      let expandedPath = filePath;
      if (filePath.startsWith('~/')) {
        expandedPath = filePath.replace('~', os.homedir());
      }

      if (!fs.existsSync(expandedPath)) {
        return { success: false, error: 'File not found' };
      }

      shell.showItemInFolder(expandedPath);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
