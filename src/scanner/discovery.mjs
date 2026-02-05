// src/scanner/discovery.mjs
// File discovery with early filtering

import { readdirSync } from 'fs';
import { join, basename } from 'path';
import { detectLanguage } from '../languages/index.mjs';

// Skip these directories immediately
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', '.next', '.nuxt',
  '__pycache__', '.pytest_cache', 'venv', '.venv', 'env', '.env',
  'vendor', 'target', '.gradle', '.idea', '.vscode',
  'coverage', '.nyc_output', '.swynx-cache'
]);

const SKIP_FILE_PATTERNS = [
  /\.min\./, /\.bundle\./, /\.chunk\./
];

export function discoverFiles(rootPath, options = {}) {
  const {
    extensions = null, // null = all supported languages
    maxDepth = 50,
    onProgress = null
  } = options;

  const files = [];
  let scanned = 0;

  function walk(dir, depth = 0) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        if (name.startsWith('.')) continue;
        walk(join(dir, name), depth + 1);
        continue;
      }

      // Skip hidden files and minified bundles
      if (name.startsWith('.')) continue;
      if (SKIP_FILE_PATTERNS.some(p => p.test(name))) continue;

      // Extension filter
      if (extensions) {
        const ext = name.slice(name.lastIndexOf('.'));
        if (!extensions.includes(ext)) continue;
      } else {
        // Only include files we can parse
        const fullPath = join(dir, name);
        const relativePath = fullPath.slice(rootPath.length + 1);
        if (!detectLanguage(relativePath)) continue;
      }

      const fullPath = join(dir, name);
      const relativePath = fullPath.slice(rootPath.length + 1);
      files.push(relativePath);

      scanned++;
      if (onProgress && scanned % 100 === 0) {
        onProgress(scanned);
      }
    }
  }

  walk(rootPath);
  return files;
}

export function getSupportedExtensions() {
  return [
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts',
    '.py', '.pyi',
    '.go',
    '.java', '.kt', '.kts'
  ];
}
