// src/cache/hash.mjs
// Content hashing utilities for cache invalidation

import { createHash } from 'crypto';
import { readFileSync } from 'fs';

/**
 * Read a file and return its SHA-256 hash (first 16 hex characters).
 * @param {string} filePath - Absolute path to the file.
 * @returns {string} 16-char hex hash prefix.
 */
export function hashFile(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Hash a string and return its SHA-256 hash (first 16 hex characters).
 * @param {string} content - The string to hash.
 * @returns {string} 16-char hex hash prefix.
 */
export function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
