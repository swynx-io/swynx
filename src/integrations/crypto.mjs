/**
 * Credential Encryption
 *
 * AES-256-GCM encryption for stored Git platform tokens.
 * Key derived from machine fingerprint + licence key via scrypt.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { hostname } from 'os';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;

let _cachedKey = null;
let _cachedSaltPath = null;

/**
 * Get machine fingerprint (same approach as licence/activation.mjs)
 */
function getMachineFingerprint() {
  const machineId = hostname() + process.platform + process.arch;
  return createHash('sha256').update(machineId).digest('hex').slice(0, 32);
}

/**
 * Get or create the salt file for key derivation
 */
function getOrCreateSalt(dataDir) {
  const saltPath = join(dataDir, 'connections.salt');
  if (existsSync(saltPath)) {
    return readFileSync(saltPath);
  }
  const salt = randomBytes(SALT_LENGTH);
  writeFileSync(saltPath, salt);
  return salt;
}

/**
 * Derive encryption key from machine fingerprint + licence key
 */
function deriveKey(dataDir, licenceKey) {
  const saltPath = join(dataDir, 'connections.salt');
  if (_cachedKey && _cachedSaltPath === saltPath) {
    return _cachedKey;
  }

  const salt = getOrCreateSalt(dataDir);
  const fingerprint = getMachineFingerprint();
  const keyMaterial = fingerprint + (licenceKey || 'swynx-default');
  const key = scryptSync(keyMaterial, salt, KEY_LENGTH);

  _cachedKey = key;
  _cachedSaltPath = saltPath;
  return key;
}

/**
 * Encrypt a plaintext credential string
 * @param {string} plaintext - The token/password to encrypt
 * @param {string} dataDir - Path to DATA_DIR
 * @param {string} [licenceKey] - Optional licence key for key derivation
 * @returns {{ encrypted: string, iv: string, tag: string }}
 */
export function encrypt(plaintext, dataDir, licenceKey) {
  const key = deriveKey(dataDir, licenceKey);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('base64'),
    tag: tag.toString('base64')
  };
}

/**
 * Decrypt an encrypted credential
 * @param {{ encrypted: string, iv: string, tag: string }} cipherData
 * @param {string} dataDir - Path to DATA_DIR
 * @param {string} [licenceKey] - Optional licence key for key derivation
 * @returns {string} The plaintext token/password
 */
export function decrypt(cipherData, dataDir, licenceKey) {
  const key = deriveKey(dataDir, licenceKey);
  const iv = Buffer.from(cipherData.iv, 'base64');
  const tag = Buffer.from(cipherData.tag, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(cipherData.encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Clear the cached key (e.g. on licence change)
 */
export function clearKeyCache() {
  _cachedKey = null;
  _cachedSaltPath = null;
}

/**
 * Mask a token for display: ***...{last4}
 */
export function maskToken(token) {
  if (!token || token.length < 8) return '***';
  return `***...${token.slice(-4)}`;
}
