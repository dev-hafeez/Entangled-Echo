import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM

/**
 * Derives a 32-byte key from environment or default
 */
export function getEncryptionKey(customKey?: string | Buffer): Buffer {
  if (customKey) {
    if (Buffer.isBuffer(customKey) && customKey.length === 32) return customKey;
    return crypto.createHash('sha256').update(customKey).digest();
  }

  const envKey = process.env.TOKEN_ENC_KEY;
  if (envKey) {
    // If base64 32 bytes
    const buf = Buffer.from(envKey, 'base64');
    if (buf.length === 32) return buf;
    // Fall back to sha256 of raw string
    return crypto.createHash('sha256').update(envKey).digest();
  }

  // Deterministic fallback for dev/offline testing (with warning)
  return crypto.createHash('sha256').update('entangled-echo-default-encryption-salt-2026').digest();
}

export interface EncryptedPayload {
  algorithm: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  serialized: string;
}

/**
 * Encrypt a plaintext token using AES-256-GCM (FR-08)
 */
export function encryptToken(plainText: string, customKey?: string | Buffer): EncryptedPayload {
  if (!plainText) {
    throw new Error('Cannot encrypt empty or null token');
  }

  const key = getEncryptionKey(customKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plainText, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  const ivHex = iv.toString('hex');

  const serialized = `${ALGORITHM}:${ivHex}:${authTag}:${ciphertext}`;

  return {
    algorithm: ALGORITHM,
    iv: ivHex,
    authTag,
    ciphertext,
    serialized,
  };
}

/**
 * Decrypt an AES-256-GCM encrypted payload or serialized string (FR-08)
 */
export function decryptToken(
  encryptedInput: string | { iv: string; authTag: string; ciphertext: string },
  customKey?: string | Buffer
): string {
  const key = getEncryptionKey(customKey);

  let ivHex: string;
  let authTagHex: string;
  let ciphertextHex: string;

  if (typeof encryptedInput === 'string') {
    const parts = encryptedInput.split(':');
    if (parts.length === 4 && parts[0] === ALGORITHM) {
      [, ivHex, authTagHex, ciphertextHex] = parts;
    } else {
      throw new Error(`Invalid serialized token format. Expected ${ALGORITHM}:iv:tag:ciphertext`);
    }
  } else {
    ivHex = encryptedInput.iv;
    authTagHex = encryptedInput.authTag;
    ciphertextHex = encryptedInput.ciphertext;
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Store an encrypted token safely at rest under storage/tokens/{handle}.enc.json
 */
export function storeEncryptedToken(
  handle: string,
  plainToken: string,
  customKey?: string | Buffer
): EncryptedPayload {
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');
  const tokensDir = path.join(config.localStorageDir, 'tokens');
  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true, mode: 0o700 });
  }

  const encrypted = encryptToken(plainToken, customKey);
  const targetPath = path.join(tokensDir, `${cleanHandle}.enc.json`);

  const record = {
    handle: cleanHandle,
    algorithm: encrypted.algorithm,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    ciphertext: encrypted.ciphertext,
    serialized: encrypted.serialized,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(targetPath, JSON.stringify(record, null, 2), { mode: 0o600 });
  return encrypted;
}

/**
 * Retrieve and decrypt a token stored at rest under storage/tokens/{handle}.enc.json
 */
export function getDecryptedToken(handle: string, customKey?: string | Buffer): string | null {
  const cleanHandle = handle.toLowerCase().replace(/^@/, '');
  const tokenFile = path.join(config.localStorageDir, 'tokens', `${cleanHandle}.enc.json`);
  if (!fs.existsSync(tokenFile)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
    if (!data.serialized && (!data.iv || !data.authTag || !data.ciphertext)) {
      return null;
    }
    return decryptToken(data.serialized || data, customKey);
  } catch (err) {
    console.error(`Failed to decrypt token for @${cleanHandle}:`, err);
    return null;
  }
}
