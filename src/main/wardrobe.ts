import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

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

  const files = {
    idle: path.join(outfitDir, 'char-idle.png'),
    blink: path.join(outfitDir, 'char-blink.png'),
    speaking: path.join(outfitDir, 'char-speaking.png'),
  };

  for (const [key, filePath] of Object.entries(files)) {
    if (!fs.existsSync(filePath)) {
      console.warn(`[Wardrobe] Missing sprite ${key}: ${filePath}`);
      return null;
    }
  }

  return {
    idle: fs.readFileSync(files.idle).toString('base64'),
    blink: fs.readFileSync(files.blink).toString('base64'),
    speaking: fs.readFileSync(files.speaking).toString('base64'),
  };
}

/**
 * Get the currently active outfit name.
 */
export function getCurrentOutfit(): string {
  return currentOutfit;
}

/**
 * Set the active outfit.
 */
export function setCurrentOutfit(name: string): void {
  currentOutfit = name;
  console.log(`[Wardrobe] Active outfit: ${name}`);
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
