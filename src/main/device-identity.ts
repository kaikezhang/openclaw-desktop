import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface DeviceIdentity {
  version: 1;
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fingerprintPublicKey(publicKeyPem: string): string {
  const publicKey = crypto.createPublicKey(publicKeyPem);
  const raw = publicKey.export({ type: 'spki', format: 'der' });
  const hash = crypto.createHash('sha256').update(raw).digest();
  return base64UrlEncode(hash);
}

function generateIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const deviceId = fingerprintPublicKey(publicKey);
  return { version: 1, deviceId, publicKeyPem: publicKey, privateKeyPem: privateKey };
}

function tryLoadIdentity(filePath: string): DeviceIdentity | null {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed?.version === 1 && parsed.deviceId && parsed.publicKeyPem && parsed.privateKeyPem) {
        console.log(`[DeviceIdentity] Loaded from ${filePath}`);
        return parsed as DeviceIdentity;
      }
    }
  } catch (e) {
    console.warn(`[DeviceIdentity] Failed to load from ${filePath}:`, e);
  }
  return null;
}

export function loadOrCreateDeviceIdentity(): DeviceIdentity {
  const homedir = require('os').homedir();

  // Priority: 1) OpenClaw system identity, 2) App-specific identity, 3) Generate new
  const candidates = [
    path.join(homedir, '.openclaw', 'identity', 'device.json'),
    path.join(app.getPath('userData'), 'device-identity.json'),
  ];

  for (const candidate of candidates) {
    const identity = tryLoadIdentity(candidate);
    if (identity) return identity;
  }

  // Generate new
  console.log('[DeviceIdentity] Generating new device identity...');
  const identity = generateIdentity();
  const newPath = path.join(app.getPath('userData'), 'device-identity.json');
  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  fs.writeFileSync(newPath, JSON.stringify(identity, null, 2) + '\n', { mode: 0o600 });
  console.log(`[DeviceIdentity] Created: ${identity.deviceId}`);
  return identity;
}

export function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

export function publicKeyRawBase64Url(publicKeyPem: string): string {
  const publicKey = crypto.createPublicKey(publicKeyPem);
  const raw = publicKey.export({ type: 'spki', format: 'der' });
  // Extract raw key bytes (last 32 bytes for ed25519)
  return base64UrlEncode(raw.subarray(-32));
}

export function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce?: string;
}): string {
  const version = params.nonce ? 'v2' : 'v1';
  const scopes = params.scopes.join(',');
  const token = params.token ?? '';
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
  ];
  if (version === 'v2') base.push(params.nonce ?? '');
  return base.join('|');
}
