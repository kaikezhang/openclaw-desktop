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
  openSettingsWindow: () => void;
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

  ipcMain.handle('image:generateSelfie', async (_event, promptOrOpts: string | { prompt: string; outfitDescription?: string }) => {
    try {
      const opts = typeof promptOrOpts === 'string' ? { prompt: promptOrOpts } : promptOrOpts;
      const imagePath = await imageGenEngine.generateSelfie(opts);
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

  ipcMain.handle('settings:open', async () => {
    deps.openSettingsWindow();
  });

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

      // Chinese keyword → English alias mapping for common outfit terms
      const OUTFIT_ALIASES: Record<string, string[]> = {
        '旗袍': ['qipao', 'chinese dress'],
        '校服': ['school uniform'],
        '汉服': ['hanfu'],
        '女仆': ['maid'],
        '和服': ['kimono'],
        '洛丽塔': ['lolita'],
        '婚纱': ['wedding dress'],
        '泳装': ['swimsuit', 'bikini'],
      };

      // Normalize description to name (preserve Chinese for matching)
      const name = description.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
      const descLower = description.toLowerCase();

      // Build search terms: original description + any aliases
      const searchTerms = [descLower];
      for (const [cn, aliases] of Object.entries(OUTFIT_ALIASES)) {
        if (descLower.includes(cn)) searchTerms.push(...aliases);
      }

      // Check if we have it in wardrobe (exact match or fuzzy)
      const match = outfits.find(o => {
        if (o.name === name) return true;
        const oDesc = o.description.toLowerCase();
        const oName = o.name.toLowerCase();
        return searchTerms.some(term =>
          oDesc.includes(term) || oName.includes(term) ||
          term.includes(oName)
        );
      });

      if (match) {
        // Found in wardrobe — load immediately
        const sprites = getOutfit(match.name);
        if (sprites) {
          setCurrentOutfit(match.name);
          const win = BrowserWindow.getAllWindows()[0];
          win?.webContents.send('outfit:change', { status: 'ready', outfit: match.name, sprites, description: match.description });
          return { success: true, cached: true, outfit: match.name };
        }
      }

      // Not in wardrobe — generate in background
      // If name is empty (all CJK chars), use first alias or transliterate
      const genName = name || (searchTerms.find(t => /^[a-z]/.test(t))?.replace(/\s+/g, '-') || `outfit-${Date.now()}`);
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('outfit:change', { status: 'loading', outfit: genName });

      // Run generate-outfit.py on the SERVER via SSH
      const { spawn } = require('child_process');
      const REMOTE_HOST = process.env.OPENCLAW_SSH_HOST || 'kaike@5.78.150.16';
      const REMOTE_PROJECT = '~/.openclaw/workspace/openclaw-desktop';
      const safeDesc = description.replace(/'/g, "'\\''"); // escape single quotes
      const remoteCmd = `export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:$PATH" && source ~/.openclaw/.env.outfit 2>/dev/null; cd ${REMOTE_PROJECT} && PYTHONUNBUFFERED=1 uv run scripts/generate-outfit.py --outfit '${safeDesc}' --name '${genName}'`;

      console.log(`[Outfit] Generating: "${description}" as "${genName}"...`);

      const proc = spawn('ssh', ['-o', 'StrictHostKeyChecking=no', REMOTE_HOST, remoteCmd], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); console.log('[Outfit]', d.toString().trim()); });
      proc.stderr?.on('data', (d: Buffer) => { console.error('[Outfit ERR]', d.toString().trim()); });

      proc.on('close', async (code: number) => {
        if (code === 0) {
          // Sprites are on the server — fetch them via SSH + base64
          console.log(`[Outfit] Generation done, fetching sprites from server...`);
          try {
            const { execSync } = require('child_process');
            const remoteDir = `${REMOTE_PROJECT}/assets/character/wanwan/outfits/${genName}`;
            const fetchSprite = (file: string): string => {
              return execSync(
                `ssh -o StrictHostKeyChecking=no ${REMOTE_HOST} "base64 ${remoteDir}/${file}"`,
                { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
              ).replace(/\s/g, '');
            };
            const sprites: Record<string, string> = {
              idle: fetchSprite('char-idle.png'),
              blink: fetchSprite('char-blink.png'),
              speaking: fetchSprite('char-speaking.png'),
            };
            // Try to fetch optional speaking frames
            const tryFetch = (file: string): string | null => {
              try { return fetchSprite(file); } catch { return null; }
            };
            const s1 = tryFetch('char-speaking-1.png');
            const s2 = tryFetch('char-speaking-2.png');
            if (s1) sprites['speaking-1'] = s1;
            if (s2) sprites['speaking-2'] = s2;

            // Also save locally for caching
            const path = require('path');
            const fs = require('fs');
            const { app } = require('electron');
            const localDir = path.join(app.getPath('userData'), 'outfits', genName);
            fs.mkdirSync(localDir, { recursive: true });
            for (const [key, b64] of Object.entries(sprites)) {
              const fname = key === 'idle' ? 'char-idle.png' :
                            key === 'blink' ? 'char-blink.png' :
                            key === 'speaking' ? 'char-speaking.png' :
                            key === 'speaking-1' ? 'char-speaking-1.png' :
                            key === 'speaking-2' ? 'char-speaking-2.png' : null;
              if (fname) fs.writeFileSync(path.join(localDir, fname), Buffer.from(b64, 'base64'));
            }
            // Copy metadata
            try {
              const metaJson = execSync(
                `ssh -o StrictHostKeyChecking=no ${REMOTE_HOST} "cat ${remoteDir}/metadata.json"`,
                { encoding: 'utf-8' }
              );
              fs.writeFileSync(path.join(localDir, 'metadata.json'), metaJson);
            } catch {}

            setCurrentOutfit(genName);
            win?.webContents.send('outfit:change', { status: 'ready', outfit: genName, sprites, description: description });
            console.log(`[Outfit] Done: ${name}`);
          } catch (fetchErr: any) {
            console.error(`[Outfit] Fetch error:`, fetchErr.message);
            win?.webContents.send('outfit:change', { status: 'error', outfit: genName, error: 'Failed to fetch sprites from server' });
          }
        } else {
          win?.webContents.send('outfit:change', { status: 'error', outfit: genName, error: `Generation failed (code ${code})` });
          console.error(`[Outfit] Failed: ${name}, code=${code}\n${output}`);
        }
      });

      return { success: true, cached: false, generating: true, outfit: name };
    } catch (e: any) {
      console.error('[Outfit] Request error:', e);
      return { success: false, error: e.message };
    }
  });

  // ===== Outfit Changed Notification (tell gateway to generate selfies) =====
  ipcMain.handle('outfit:notifyChanged', async (_event, description: string) => {
    try {
      const msg = `[OUTFIT_CHANGED] 晚晚刚换了新衣服：${description}。请生成2-3张不同场景的selfie发到Discord #desk-app频道，每张用不同的场景和构图。`;
      await openclawClient.chat(msg, {
        onText: () => {},
        onDone: () => { console.log('[IPC] Outfit notification sent to gateway'); },
        onError: (err) => { console.error('[IPC] Outfit notification error:', err.message); },
      });
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] Outfit notify error:', e);
      return { success: false, error: e.message };
    }
  });

  // ===== Outfit List (wardrobe) =====
  ipcMain.handle('outfit:list', async () => {
    try {
      const { listOutfits } = await import('./wardrobe');
      return { success: true, outfits: listOutfits() };
    } catch (e: any) {
      return { success: false, error: e.message, outfits: [] };
    }
  });

  // ===== Outfit Thumbnail =====
  ipcMain.handle('outfit:thumbnail', async (_event, name: string) => {
    try {
      const { getOutfit } = await import('./wardrobe');
      const sprites = getOutfit(name);
      if (!sprites) return { success: false };
      return { success: true, idle: sprites.idle };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ===== Outfit Loading (from wardrobe) =====
  ipcMain.handle('outfit:load', async (_event, name: string) => {
    try {
      const { getOutfit, setCurrentOutfit, listOutfits } = await import('./wardrobe');
      const sprites = getOutfit(name);
      if (!sprites) {
        console.warn(`[IPC] Outfit not found: ${name}`);
        return { success: false, error: 'Outfit not found' };
      }
      setCurrentOutfit(name);
      // Get description from metadata
      const allOutfits = listOutfits();
      const meta = allOutfits.find(o => o.name === name);
      // Send to renderer
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send('outfit:change', {
          status: 'ready',
          outfit: name,
          sprites,
          description: meta?.description || name,
        });
      }
      return { success: true };
    } catch (e: any) {
      console.error('[IPC] Outfit load error:', e);
      return { success: false, error: e.message };
    }
  });
}
