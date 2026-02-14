import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface AppSettings {
  openclawPort: number;
  openclawToken: string;
  deepgramApiKey: string;
  minimaxApiKey: string;
  minimaxGroupId: string;
  minimaxModel: string;
  minimaxVoiceId: string;
  live2dModelPath: string;
  theme: 'dark' | 'light' | 'purple';
  hotkeyToggleRecord: string;
  hotkeyToggleMini: string;
  startMinimized: boolean;
  alwaysOnTop: boolean;
}

const defaults: AppSettings = {
  openclawPort: 18789,
  openclawToken: '',
  deepgramApiKey: '',
  minimaxApiKey: '',
  minimaxGroupId: '',
  minimaxModel: 'speech-02-hd',
  minimaxVoiceId: 'Chinese (Mandarin)_Warm_Girl',
  live2dModelPath: 'Hiyori/Hiyori.model3.json',
  theme: 'dark',
  hotkeyToggleRecord: 'CommandOrControl+Shift+O',
  hotkeyToggleMini: 'CommandOrControl+Shift+M',
  startMinimized: false,
  alwaysOnTop: true,
};

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadFromDisk(): AppSettings {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

function saveToDisk(settings: AppSettings): void {
  const dir = path.dirname(getSettingsPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

let cached: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (!cached) cached = loadFromDisk();
  return { ...cached };
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return getSettings()[key];
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  const s = getSettings();
  (s as any)[key] = value;
  cached = s;
  saveToDisk(s);
}

export function setSettings(patch: Partial<AppSettings>): void {
  const s = getSettings();
  Object.assign(s, patch);
  cached = s;
  saveToDisk(s);
}

export function resetSettings(): void {
  cached = { ...defaults };
  saveToDisk(cached);
}
