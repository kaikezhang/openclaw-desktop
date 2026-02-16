import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { getSetting, setSetting } from './settings-store';

export interface OutfitMetadata {
  name: string;
  description: string;
  timestamp: string;
  sprites: {
    idle: string;
    blink: string;
    speaking: string;
  };
}

export interface OutfitSprites {
  idle: string;   // base64 PNG
  blink: string;  // base64 PNG
  speaking: string; // base64 PNG
}

export interface OutfitInfo {
  name: string;
  description: string;
  timestamp: string;
}

// Store outfits in user data directory (persistent across updates, not in git)
const OUTFITS_DIR = path.join(app.getPath('userData'), 'outfits');
const DEFAULT_OUTFIT = '__default__';

let currentOutfit: string = DEFAULT_OUTFIT;

/**
 * Ensure the outfits directory exists.
 */
function ensureOutfitsDir(): void {
  fs.mkdirSync(OUTFITS_DIR, { recursive: true });
}

/**
 * List all available outfits.
 */
export function listOutfits(): OutfitInfo[] {
  ensureOutfitsDir();

  const entries = fs.readdirSync(OUTFITS_DIR, { withFileTypes: true });
  const outfits: OutfitInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const metaPath = path.join(OUTFITS_DIR, entry.name, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;

    try {
      const meta: OutfitMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      outfits.push({
        name: meta.name,
        description: meta.description,
        timestamp: meta.timestamp,
      });
    } catch {
      // Skip malformed metadata
    }
  }

  return outfits.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Load an outfit's sprites as base64 data.
 */
export function getOutfit(name: string): OutfitSprites | null {
  const outfitDir = path.join(OUTFITS_DIR, name);
  if (!fs.existsSync(outfitDir)) return null;

  const requiredFiles: Record<string, string> = {
    idle: path.join(outfitDir, 'char-idle.png'),
    blink: path.join(outfitDir, 'char-blink.png'),
    speaking: path.join(outfitDir, 'char-speaking.png'),
  };

  const optionalFiles: Record<string, string> = {
    'speaking-1': path.join(outfitDir, 'char-speaking-1.png'),
    'speaking-2': path.join(outfitDir, 'char-speaking-2.png'),
  };

  for (const [key, filePath] of Object.entries(requiredFiles)) {
    if (!fs.existsSync(filePath)) {
      console.warn(`[Wardrobe] Missing sprite ${key}: ${filePath}`);
      return null;
    }
  }

  const result: Record<string, string> = {
    idle: fs.readFileSync(requiredFiles.idle).toString('base64'),
    blink: fs.readFileSync(requiredFiles.blink).toString('base64'),
    speaking: fs.readFileSync(requiredFiles.speaking).toString('base64'),
  };

  // Load optional speaking frames
  for (const [key, filePath] of Object.entries(optionalFiles)) {
    if (fs.existsSync(filePath)) {
      result[key] = fs.readFileSync(filePath).toString('base64');
    }
  }

  return result as unknown as OutfitSprites;
}

/**
 * Get the currently active outfit name.
 */
export function getCurrentOutfit(): string {
  return currentOutfit;
}

/**
 * Set the active outfit and persist to settings.
 */
export function setCurrentOutfit(name: string): void {
  currentOutfit = name;
  // Persist to settings so it survives restart
  try {
    setSetting('currentOutfit', name);
  } catch (e) {
    console.warn('[Wardrobe] Failed to save outfit to settings:', e);
  }
  console.log(`[Wardrobe] Active outfit: ${name}`);
}

/**
 * Load the saved outfit from settings on startup.
 */
export function loadSavedOutfit(): string {
  try {
    const saved = getSetting('currentOutfit');
    console.log(`[Wardrobe] loadSavedOutfit: saved="${saved}"`);
    if (saved && saved !== '__default__') {
      // Verify the outfit still exists
      const outfitDir = path.join(OUTFITS_DIR, saved);
      console.log(`[Wardrobe] Checking outfit dir: ${outfitDir}, exists=${fs.existsSync(outfitDir)}`);
      if (fs.existsSync(outfitDir)) {
        console.log(`[Wardrobe] Loaded saved outfit: ${saved}`);
        return saved;
      }
    }
  } catch (e) {
    console.warn('[Wardrobe] Failed to load saved outfit:', e);
  }
  return DEFAULT_OUTFIT;
}

/**
 * Save a new outfit from base64 sprite data.
 */
export function saveOutfit(
  name: string,
  sprites: OutfitSprites,
  metadata: Omit<OutfitMetadata, 'sprites'>,
): void {
  ensureOutfitsDir();
  const outfitDir = path.join(OUTFITS_DIR, name);
  fs.mkdirSync(outfitDir, { recursive: true });

  // Save sprites
  fs.writeFileSync(path.join(outfitDir, 'char-idle.png'), Buffer.from(sprites.idle, 'base64'));
  fs.writeFileSync(path.join(outfitDir, 'char-blink.png'), Buffer.from(sprites.blink, 'base64'));
  fs.writeFileSync(path.join(outfitDir, 'char-speaking.png'), Buffer.from(sprites.speaking, 'base64'));

  // Save metadata
  const fullMeta: OutfitMetadata = {
    ...metadata,
    sprites: {
      idle: 'char-idle.png',
      blink: 'char-blink.png',
      speaking: 'char-speaking.png',
    },
  };
  fs.writeFileSync(
    path.join(outfitDir, 'metadata.json'),
    JSON.stringify(fullMeta, null, 2),
  );

  console.log(`[Wardrobe] Saved outfit: ${name}`);
}
