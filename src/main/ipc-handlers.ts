import { ipcMain, shell, BrowserWindow, Notification } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import { OpenClawClient } from './openclaw-client';
import { TTSEngine } from './tts-engine';
import { ImageGenEngine } from './image-gen';
import { getSettings, setSettings, type AppSettings } from './settings-store';

/**
 * Register all IPC handlers.
 * Wires the renderer ↔ main process communication.
 */
export function registerIpcHandlers(deps: {
  getWindow: () => BrowserWindow | null;
  openclawClient: OpenClawClient;
  ttsEngine: TTSEngine;
  imageGenEngine: ImageGenEngine;
  getLoginItem: () => boolean;
  setLoginItem: (enabled: boolean) => void;
}): void {
  const { getWindow, openclawClient, ttsEngine, imageGenEngine, getLoginItem, setLoginItem } = deps;

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

  // ===== Connection Status =====

  ipcMain.handle('openclaw:status', async () => {
    return { connected: openclawClient.isConnected };
  });

  ipcMain.handle('openclaw:newSession', async () => {
    const sessionKey = openclawClient.newSession();
    return { sessionKey };
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

  // ===== Image Generation =====

  ipcMain.handle('image:generateSelfie', async (_event, prompt: string) => {
    try {
      const imagePath = await imageGenEngine.generateSelfie({ prompt });
      if (imagePath) {
        return { success: true, path: imagePath };
      }
      return { success: false, error: 'No image generated (check FAL_KEY)' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ===== System Notifications =====

  ipcMain.handle('notify', async (_event, opts: { title: string; body: string }) => {
    const win = getWindow();
    // Only notify if window is not focused
    if (win && !win.isFocused()) {
      const notification = new Notification({
        title: opts.title || 'OpenClaw Desktop',
        body: opts.body || '',
        icon: undefined, // Uses app icon
      });
      notification.on('click', () => {
        if (win) {
          win.show();
          win.focus();
        }
      });
      notification.show();
    }
    return { success: true };
  });

  // ===== Settings =====

  ipcMain.handle('settings:get', async () => {
    return getSettings();
  });

  ipcMain.handle('settings:set', async (_event, patch: Partial<AppSettings>) => {
    setSettings(patch);
    return { success: true };
  });

  ipcMain.handle('settings:getLoginItem', async () => {
    return { enabled: getLoginItem() };
  });

  ipcMain.handle('settings:setLoginItem', async (_event, enabled: boolean) => {
    setLoginItem(enabled);
    return { success: true };
  });

  // ===== Outfit Request (search wardrobe or generate) =====
  ipcMain.handle('outfit:request', async (_event, description: string) => {
    try {
      const { listOutfits, getOutfit, setCurrentOutfit } = await import('./wardrobe');
      const outfits = listOutfits();

      // Normalize description to name
      const name = description.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');

      // Check if we have it in wardrobe (exact match or fuzzy)
      const match = outfits.find(o =>
        o.name === name ||
        o.description.toLowerCase().includes(description.toLowerCase()) ||
        description.toLowerCase().includes(o.name)
      );

      if (match) {
        // Found in wardrobe — load immediately
        const sprites = getOutfit(match.name);
        if (sprites) {
          setCurrentOutfit(match.name);
          const win = BrowserWindow.getAllWindows()[0];
          win?.webContents.send('outfit:change', { status: 'ready', outfit: match.name, sprites });
          return { success: true, cached: true, outfit: match.name };
        }
      }

      // Not in wardrobe — generate in background
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('outfit:change', { status: 'loading', outfit: name });

      // Run generate-outfit.py asynchronously
      const { spawn } = require('child_process');
      const path = require('path');
      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'generate-outfit.py');

      console.log(`[Outfit] Generating: "${description}" as "${name}"...`);

      const proc = spawn('uv', ['run', scriptPath, '--outfit', description, '--name', name], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); console.log('[Outfit]', d.toString().trim()); });
      proc.stderr?.on('data', (d: Buffer) => { console.error('[Outfit ERR]', d.toString().trim()); });

      proc.on('close', (code: number) => {
        if (code === 0) {
          const sprites = getOutfit(name);
          if (sprites) {
            setCurrentOutfit(name);
            win?.webContents.send('outfit:change', { status: 'ready', outfit: name, sprites });
            console.log(`[Outfit] Done: ${name}`);
          } else {
            win?.webContents.send('outfit:change', { status: 'error', outfit: name, error: 'Generation succeeded but sprites not found' });
          }
        } else {
          win?.webContents.send('outfit:change', { status: 'error', outfit: name, error: `Generation failed (code ${code})` });
          console.error(`[Outfit] Failed: ${name}, code=${code}`);
        }
      });

      return { success: true, cached: false, generating: true, outfit: name };
    } catch (e: any) {
      console.error('[Outfit] Request error:', e);
      return { success: false, error: e.message };
    }
  });

  // ===== Outfit Loading (from wardrobe) =====
  ipcMain.handle('outfit:load', async (_event, name: string) => {
    try {
      const { getOutfit, setCurrentOutfit } = await import('./wardrobe');
      const sprites = getOutfit(name);
      if (!sprites) {
        console.warn(`[IPC] Outfit not found: ${name}`);
        return { success: false, error: 'Outfit not found' };
      }
      setCurrentOutfit(name);
      // Send to renderer
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send('outfit:change', {
          status: 'ready',
          outfit: name,
          sprites,
        });
      }
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] Outfit load error:', e);
      return { success: false, error: e.message };
    }
  });
}
