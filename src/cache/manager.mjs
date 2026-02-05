// src/cache/manager.mjs
// Scan cache manager — avoids re-parsing unchanged files on subsequent scans

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

const CACHE_VERSION = 1;
const CACHE_DIR = '.swynx-cache';
const CACHE_FILE = 'scan-cache.json';

export class CacheManager {
  /**
   * @param {string} projectPath - Root directory of the project being scanned.
   */
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.cachePath = join(projectPath, CACHE_DIR, CACHE_FILE);
    this.entries = Object.create(null);
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Load the cache from disk. Non-existent or corrupt files are silently ignored.
   * @returns {CacheManager} this (for chaining)
   */
  load() {
    try {
      if (existsSync(this.cachePath)) {
        const raw = readFileSync(this.cachePath, 'utf8');
        const data = JSON.parse(raw);

        if (data && data.version === CACHE_VERSION && data.entries) {
          this.entries = data.entries;
        }
      }
    } catch {
      // Corrupt or unreadable cache — start fresh
      this.entries = Object.create(null);
    }

    return this;
  }

  /**
   * Retrieve a cached parse result if the file hash still matches.
   * @param {string} relativePath - Project-relative file path (e.g. "src/utils/helper.js").
   * @param {string} currentHash  - Current content hash of the file.
   * @returns {object|null} The cached parse result, or null on miss.
   */
  get(relativePath, currentHash) {
    const entry = this.entries[relativePath];

    if (entry && entry.hash === currentHash) {
      this.hits++;
      return entry.result;
    }

    this.misses++;
    return null;
  }

  /**
   * Store a parse result in the cache.
   * @param {string} relativePath - Project-relative file path.
   * @param {string} hash         - Content hash at parse time.
   * @param {object} result       - The parsed file result to cache.
   */
  set(relativePath, hash, result) {
    this.entries[relativePath] = {
      hash,
      result,
      timestamp: Date.now(),
    };
  }

  /**
   * Persist the cache to disk.
   */
  save() {
    const dir = dirname(this.cachePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const data = {
      version: CACHE_VERSION,
      entries: this.entries,
    };

    writeFileSync(this.cachePath, JSON.stringify(data), 'utf8');
  }

  /**
   * Delete the cache file from disk and reset in-memory state.
   */
  clear() {
    if (existsSync(this.cachePath)) {
      unlinkSync(this.cachePath);
    }

    this.entries = Object.create(null);
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Return cache statistics for the current session.
   * @returns {{ hits: number, misses: number, entries: number }}
   */
  stats() {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: Object.keys(this.entries).length,
    };
  }
}
