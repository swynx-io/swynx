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
    // JavaScript/TypeScript
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.vue',
    // Python
    '.py', '.pyi',
    // Go
    '.go',
    // Java
    '.java',
    // Kotlin
    '.kt', '.kts',
    // PHP
    '.php', '.phtml', '.php3', '.php4', '.php5', '.phps',
    // Ruby
    '.rb', '.rake', '.gemspec', '.ru',
    // Rust
    '.rs',
    // C#
    '.cs',
    // Dart
    '.dart',
    // Swift
    '.swift',
    // Scala
    '.scala', '.sc',
    // Elixir
    '.ex', '.exs',
    // Haskell
    '.hs', '.lhs',
    // Lua
    '.lua',
    // C/C++
    '.c', '.h', '.cpp', '.hpp', '.cc', '.hh', '.cxx', '.hxx', '.c++', '.h++',
    // Perl
    '.pl', '.pm', '.t',
    // R
    '.r', '.R', '.Rmd',
    // Clojure
    '.clj', '.cljs', '.cljc', '.edn',
    // F#
    '.fs', '.fsi', '.fsx',
    // OCaml
    '.ml', '.mli',
    // Julia
    '.jl',
    // Zig
    '.zig',
    // Nim
    '.nim', '.nims', '.nimble',
    // Erlang
    '.erl', '.hrl',
    // Groovy
    '.groovy', '.gradle', '.gvy',
    // Crystal
    '.cr',
    // V
    '.v', '.vv',
    // Objective-C
    '.m', '.mm',
    // Shell
    '.sh', '.bash', '.zsh', '.fish',
    // PowerShell
    '.ps1', '.psm1', '.psd1',
    // COBOL
    '.cob', '.cbl', '.cpy',
    // Fortran
    '.f', '.f90', '.f95', '.f03', '.f08', '.for', '.ftn',
    // VB.NET
    '.vb'
  ];
}
