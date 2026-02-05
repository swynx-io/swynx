// src/scanner/analysers/bundles.mjs
// Build output/bundle analysis

import { existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

/**
 * Check if a directory looks like a web build (has index.html or bundled js/css)
 */
function isWebBuild(dirPath) {
  try {
    const entries = readdirSync(dirPath);
    const hasIndexHtml = entries.includes('index.html');
    const hasAssets = entries.includes('assets') || entries.includes('static');
    const hasJsFiles = entries.some(e => e.endsWith('.js'));
    const hasBinaries = entries.some(e =>
      e.endsWith('.exe') || e.endsWith('.node') ||
      e.startsWith('swynx-') || e.includes('-linux') || e.includes('-macos') || e.includes('-win')
    );

    // If it has binaries and no index.html, it's probably a binary dist, not web build
    if (hasBinaries && !hasIndexHtml) return false;

    // Must have index.html or assets folder to be a web build
    return hasIndexHtml || hasAssets;
  } catch {
    return false;
  }
}

/**
 * Analyse build output bundles
 */
export async function analyseBundles(projectPath, config = {}) {
  // Check common locations for web builds, preferring subdirectory builds
  const buildDirs = [
    'ui-src/dist', 'client/dist', 'frontend/dist', 'web/dist', 'app/dist',
    'ui-src/build', 'client/build', 'frontend/build', 'web/build', 'app/build',
    'src/dashboard/public',
    '.next', 'out', 'public/build',
    'dist', 'build'  // Check root dist/build last
  ];
  let buildDir = null;

  // Find a web build directory (not binary distributions)
  for (const dir of buildDirs) {
    const fullPath = join(projectPath, dir);
    if (existsSync(fullPath) && isWebBuild(fullPath)) {
      buildDir = fullPath;
      break;
    }
  }

  if (!buildDir) {
    return {
      hasBuild: false,
      totalSize: 0,
      files: [],
      chunks: []
    };
  }

  // Analyse build output
  const files = [];
  let totalSize = 0;

  function scanDir(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else {
        const stats = statSync(fullPath);
        const ext = extname(entry.name).toLowerCase();
        files.push({
          path: fullPath,
          name: entry.name,
          size: stats.size,
          type: getFileType(ext)
        });
        totalSize += stats.size;
      }
    }
  }

  try {
    scanDir(buildDir);
  } catch (e) {
    // Ignore errors
  }

  // Group by type
  const chunks = files.filter(f => f.type === 'js' && f.name.includes('.chunk'));

  // Calculate web build size (exclude binaries and sourcemaps)
  const webFiles = files.filter(shouldCountFile);
  const webBuildSize = webFiles.reduce((s, f) => s + f.size, 0);

  return {
    hasBuild: true,
    buildDir,
    totalSize: webBuildSize,  // Use web-only size, not total
    files: webFiles,
    chunks,
    jsSize: files.filter(f => f.type === 'js').reduce((s, f) => s + f.size, 0),
    cssSize: files.filter(f => f.type === 'css').reduce((s, f) => s + f.size, 0),
    assetSize: files.filter(f => f.type === 'asset').reduce((s, f) => s + f.size, 0)
  };
}

function getFileType(ext) {
  if (['.js', '.mjs'].includes(ext)) return 'js';
  if (['.css'].includes(ext)) return 'css';
  if (['.html'].includes(ext)) return 'html';
  if (['.map'].includes(ext)) return 'sourcemap';
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'].includes(ext)) return 'asset';
  if (['.woff', '.woff2', '.ttf', '.eot'].includes(ext)) return 'font';
  // Skip binaries - these shouldn't be in a web build
  if (['.exe', '.node', '.bin', ''].includes(ext)) return 'binary';
  return 'other';
}

function shouldCountFile(file) {
  // Don't count binaries or sourcemaps in build size
  return file.type !== 'binary' && file.type !== 'sourcemap';
}

export default { analyseBundles };
