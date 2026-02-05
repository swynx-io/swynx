// src/scanner/discovery.mjs
// File discovery utilities

import { statSync, existsSync, readFileSync } from 'fs';
import { join, extname, relative } from 'path';
import { glob } from 'glob';

/**
 * Parse .gitmodules file to extract submodule paths
 * @param {string} projectPath - Project root path
 * @returns {string[]} - Array of submodule paths (as glob patterns)
 */
function getGitSubmodulePaths(projectPath) {
  const gitmodulesPath = join(projectPath, '.gitmodules');
  if (!existsSync(gitmodulesPath)) return [];

  const submodulePaths = [];
  try {
    const content = readFileSync(gitmodulesPath, 'utf-8');
    // Match: path = vendor/shared-lib
    const pathMatches = content.matchAll(/^\s*path\s*=\s*(.+)$/gm);
    for (const match of pathMatches) {
      const submodulePath = match[1].trim();
      // Add as glob pattern to exclude entire directory
      submodulePaths.push(`${submodulePath}/**`);
    }
  } catch {
    // Ignore parse errors
  }
  return submodulePaths;
}

const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.swynx-quarantine/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.min.css',
  // Exclude log directories and files (can be huge, not code)
  '**/logs/**',
  '**/log/**',
  '**/*.log',
  // Exclude temp/cache directories
  '**/tmp/**',
  '**/temp/**',
  '**/.cache/**',
  '**/cache/**',
  // Exclude Python cache
  '**/__pycache__/**',
  '**/*.pyc',
  '**/*.pyo',
  // Exclude other common non-JS caches
  '**/.pytest_cache/**',
  '**/.mypy_cache/**',
  // Exclude data files
  '**/*.sql',
  '**/*.sqlite',
  '**/*.sqlite3',
  '**/*.db',
  // Exclude large binary/media (analyzed separately via assets)
  '**/*.mp4',
  '**/*.mov',
  '**/*.avi',
  '**/*.zip',
  '**/*.tar',
  '**/*.gz',
  '**/*.rar'
];

/**
 * Discover all files in project
 */
export async function discoverFiles(projectPath, options = {}) {
  // Get git submodule paths to exclude
  const submodulePaths = getGitSubmodulePaths(projectPath);

  // Combine default excludes with submodule paths
  const exclude = [...(options.exclude || DEFAULT_EXCLUDE), ...submodulePaths];
  const include = options.include || ['**/*'];
  const onProgress = options.onProgress || (() => {});

  const files = [];

  // Report that we're starting the glob (this allows heartbeat to show activity)
  onProgress({ current: 0, total: 0, file: 'Scanning directory structure...' });

  for (const pattern of include) {
    // Use async glob to allow event loop to run (enables heartbeat during large scans)
    const matches = await glob(pattern, {
      cwd: projectPath,
      ignore: exclude,
      nodir: true,
      absolute: false
    });

    const total = matches.length;
    let processed = 0;

    // Report that glob is complete, now processing files
    onProgress({ current: 0, total, file: `Found ${total} files, processing...` });

    for (const match of matches) {
      const fullPath = join(projectPath, match);
      if (existsSync(fullPath)) {
        try {
          const stats = statSync(fullPath);
          files.push({
            path: fullPath,
            relativePath: match,
            size: stats.size,
            ext: extname(match).toLowerCase()
          });
        } catch (e) {
          // Skip files we can't stat
        }
      }

      processed++;
      // Report progress every 2 files to give more frequent updates
      if (processed % 2 === 0 || processed === total) {
        onProgress({ current: processed, total, file: match });
        // Yield to event loop every 2 files to allow heartbeat to fire
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  }

  return files;
}

/**
 * Categorize files by type
 */
export function categoriseFiles(files) {
  const categories = {
    javascript: [],
    python: [],
    java: [],
    kotlin: [],
    csharp: [],
    go: [],
    rust: [],
    css: [],
    assets: [],
    other: []
  };

  for (const file of files) {
    const ext = file.ext;
    if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue'].includes(ext)) {
      categories.javascript.push(file);
    } else if (['.py', '.pyi'].includes(ext)) {
      categories.python.push(file);
    } else if (['.java'].includes(ext)) {
      categories.java.push(file);
    } else if (['.kt', '.kts'].includes(ext)) {
      categories.kotlin.push(file);
    } else if (['.cs'].includes(ext)) {
      categories.csharp.push(file);
    } else if (['.go'].includes(ext)) {
      categories.go.push(file);
    } else if (['.rs'].includes(ext)) {
      categories.rust.push(file);
    } else if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
      categories.css.push(file);
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
      categories.assets.push(file);
    } else {
      categories.other.push(file);
    }
  }

  return categories;
}

/**
 * Get total size of files
 */
export function getTotalSize(files) {
  return files.reduce((sum, f) => sum + (f.size || 0), 0);
}

export default { discoverFiles, categoriseFiles, getTotalSize };
