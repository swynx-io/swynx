// src/fixer/unified-fix.mjs
// Unified fix system - handles multiple types of waste cleanup

import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { deleteFiles } from './deleter.mjs';
import { cleanDeadImports } from './import-cleaner.mjs';
import { cleanBarrelExports } from './barrel-cleaner.mjs';
import { commitFix, isGitRepo } from './git.mjs';
import { createSnapshot, listSnapshots, restoreSnapshot } from './snapshot.mjs';
import { execSync } from 'child_process';

/**
 * Unified fix - clean up all detected waste
 * @param {string} projectPath - Project root
 * @param {object} scanResult - Full scan result from Swynx
 * @param {object} options - Options
 */
export async function unifiedFix(projectPath, scanResult, options = {}) {
  const {
    dryRun = false,
    fixDeadCode = true,
    fixUnusedAssets = true,
    fixUnusedDeps = true,
    minConfidence = 0,
    noGitCommit = false,
    verbose = false
  } = options;

  const result = {
    deadCode: { deleted: [], skipped: [], errors: [] },
    unusedAssets: { deleted: [], skipped: [], errors: [] },
    unusedDeps: { removed: [], skipped: [], errors: [] },
    importsRemoved: [],
    exportsRemoved: [],
    emptyDirsRemoved: [],
    snapshotId: null,
    commit: null,
    summary: {
      totalFilesRemoved: 0,
      totalBytesFreed: 0,
      totalDepsRemoved: 0
    }
  };

  // Collect all files to backup
  const allFilesToBackup = [];

  // === Dead Code ===
  let deadFiles = [];
  if (fixDeadCode) {
    deadFiles = extractDeadFiles(scanResult, minConfidence);
    if (verbose) console.log(`[fix] Found ${deadFiles.length} dead code files`);
    allFilesToBackup.push(...deadFiles.map(f => f.path));
  }

  // === Unused Assets ===
  let unusedAssets = [];
  if (fixUnusedAssets) {
    unusedAssets = extractUnusedAssets(scanResult);
    if (verbose) console.log(`[fix] Found ${unusedAssets.length} unused assets`);
    allFilesToBackup.push(...unusedAssets.map(f => f.path));
  }

  // === Unused Dependencies ===
  let unusedDeps = [];
  if (fixUnusedDeps) {
    unusedDeps = extractUnusedDeps(scanResult);
    if (verbose) console.log(`[fix] Found ${unusedDeps.length} unused dependencies`);
  }

  // If nothing to fix, return early
  if (deadFiles.length === 0 && unusedAssets.length === 0 && unusedDeps.length === 0) {
    return {
      ...result,
      message: 'No waste detected to clean up'
    };
  }

  // === Dry Run ===
  if (dryRun) {
    result.deadCode.deleted = deadFiles.map(f => ({ ...f, dryRun: true }));
    result.unusedAssets.deleted = unusedAssets.map(f => ({ ...f, dryRun: true }));
    result.unusedDeps.removed = unusedDeps.map(d => ({ ...d, dryRun: true }));

    result.summary = {
      totalFilesRemoved: deadFiles.length + unusedAssets.length,
      totalBytesFreed: [...deadFiles, ...unusedAssets].reduce((sum, f) => sum + (f.size || 0), 0),
      totalDepsRemoved: unusedDeps.length
    };

    if (!noGitCommit && isGitRepo(projectPath)) {
      result.commit = {
        dryRun: true,
        wouldCommit: {
          filesDeleted: deadFiles.length + unusedAssets.length,
          depsRemoved: unusedDeps.length
        }
      };
    }

    return result;
  }

  // === Create Snapshot ===
  if (allFilesToBackup.length > 0) {
    try {
      const snapshot = createSnapshot(projectPath, allFilesToBackup, 'unified-fix');
      result.snapshotId = snapshot.snapshotId;
    } catch (error) {
      result.deadCode.errors.push({ type: 'snapshot', error: error.message });
    }
  }

  // === Delete Dead Code Files ===
  if (deadFiles.length > 0) {
    const deleteResult = await deleteFiles(projectPath, deadFiles.map(f => f.path), {
      dryRun: false,
      createBackup: false, // Already created unified snapshot
      cleanEmptyDirs: true
    });
    result.deadCode.deleted = deleteResult.deleted;
    result.deadCode.skipped = deleteResult.skipped;
    result.deadCode.errors = deleteResult.errors;
    result.emptyDirsRemoved.push(...(deleteResult.emptyDirsRemoved || []));
  }

  // === Delete Unused Assets ===
  if (unusedAssets.length > 0) {
    const deleteResult = await deleteFiles(projectPath, unusedAssets.map(f => f.path), {
      dryRun: false,
      createBackup: false,
      cleanEmptyDirs: true
    });
    result.unusedAssets.deleted = deleteResult.deleted;
    result.unusedAssets.skipped = deleteResult.skipped;
    result.unusedAssets.errors = deleteResult.errors;
    result.emptyDirsRemoved.push(...(deleteResult.emptyDirsRemoved || []));
  }

  // === Remove Unused Dependencies ===
  if (unusedDeps.length > 0) {
    for (const dep of unusedDeps) {
      try {
        // Check if it's a dev dependency
        const pkgJsonPath = join(projectPath, 'package.json');
        if (existsSync(pkgJsonPath)) {
          const pkgJson = JSON.parse(require('fs').readFileSync(pkgJsonPath, 'utf-8'));
          const isDevDep = pkgJson.devDependencies && pkgJson.devDependencies[dep.name];

          // Run npm uninstall
          const cmd = isDevDep ? `npm uninstall -D ${dep.name}` : `npm uninstall ${dep.name}`;
          execSync(cmd, { cwd: projectPath, stdio: 'pipe' });

          result.unusedDeps.removed.push({ name: dep.name, size: dep.size });
        }
      } catch (error) {
        result.unusedDeps.errors.push({ name: dep.name, error: error.message });
      }
    }
  }

  // === Clean Dead Imports ===
  if (deadFiles.length > 0) {
    const liveFiles = await getLiveFiles(projectPath, deadFiles.map(f => f.path));
    const importCleanResult = await cleanDeadImports(projectPath, deadFiles.map(f => f.path), liveFiles, { dryRun: false });
    result.importsRemoved = importCleanResult.importsRemoved || [];

    const barrelCleanResult = await cleanBarrelExports(projectPath, deadFiles.map(f => f.path), liveFiles, { dryRun: false });
    result.exportsRemoved = barrelCleanResult.exportsRemoved || [];
  }

  // === Calculate Summary ===
  result.summary = {
    totalFilesRemoved: result.deadCode.deleted.length + result.unusedAssets.deleted.length,
    totalBytesFreed: [
      ...result.deadCode.deleted,
      ...result.unusedAssets.deleted
    ].reduce((sum, f) => sum + (f.size || 0), 0),
    totalDepsRemoved: result.unusedDeps.removed.length
  };

  // === Git Commit ===
  if (!noGitCommit && isGitRepo(projectPath)) {
    const allDeletedFiles = [
      ...result.deadCode.deleted.map(f => f.file),
      ...result.unusedAssets.deleted.map(f => f.file)
    ];
    const allModifiedFiles = [
      ...result.importsRemoved.map(i => i.file),
      ...result.exportsRemoved.map(e => e.file)
    ];

    if (allDeletedFiles.length > 0 || allModifiedFiles.length > 0 || result.unusedDeps.removed.length > 0) {
      result.commit = await createUnifiedCommit(projectPath, result);
    }
  }

  return result;
}

/**
 * Extract dead code files from scan result
 */
function extractDeadFiles(scanResult, minConfidence = 0) {
  // Try various paths where dead code might be stored
  const deadFiles = scanResult.deadFiles ||
                    scanResult.details?.deadCode?.fullyDeadFiles ||
                    scanResult.details?.deadCode?.orphanFiles ||
                    [];

  return deadFiles
    .filter(f => {
      const confidence = f.aiConfidence ?? f.confidence ?? 1;
      return confidence >= minConfidence;
    })
    .map(f => ({
      path: f.path || f.file || f.relativePath,
      size: f.size || f.sizeBytes || 0,
      type: 'dead-code'
    }));
}

/**
 * Extract unused assets from scan result
 */
function extractUnusedAssets(scanResult) {
  const unusedAssets = scanResult.unusedAssets ||
                       scanResult.details?.unusedAssets ||
                       [];

  return unusedAssets.map(f => ({
    path: f.path || f.file,
    size: f.size || f.sizeBytes || 0,
    type: 'unused-asset',
    format: f.format || f.type
  }));
}

/**
 * Extract unused dependencies from scan result
 */
function extractUnusedDeps(scanResult) {
  const unusedDeps = scanResult.unusedDeps ||
                     scanResult.details?.unusedDeps ||
                     [];

  return unusedDeps.map(d => ({
    name: d.name,
    version: d.version,
    size: d.sizeBytes || d.size || 0,
    command: d.command || `npm uninstall ${d.name}`
  }));
}

/**
 * Get list of live files in the project
 */
async function getLiveFiles(projectPath, excludeFiles) {
  const fg = await import('fast-glob');
  const excludeSet = new Set(excludeFiles.map(f => f.replace(/\\/g, '/')));

  const files = await fg.default(['**/*.{js,jsx,ts,tsx,mjs,cjs,vue}'], {
    cwd: projectPath,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.swynx-*/**'],
    absolute: false
  });

  return files.filter(f => !excludeSet.has(f.replace(/\\/g, '/')));
}

/**
 * Create unified commit message
 */
async function createUnifiedCommit(projectPath, result) {
  const { execSync } = await import('child_process');

  const parts = [];
  if (result.deadCode.deleted.length > 0) {
    parts.push(`${result.deadCode.deleted.length} dead file${result.deadCode.deleted.length > 1 ? 's' : ''}`);
  }
  if (result.unusedAssets.deleted.length > 0) {
    parts.push(`${result.unusedAssets.deleted.length} unused asset${result.unusedAssets.deleted.length > 1 ? 's' : ''}`);
  }
  if (result.unusedDeps.removed.length > 0) {
    parts.push(`${result.unusedDeps.removed.length} unused dep${result.unusedDeps.removed.length > 1 ? 's' : ''}`);
  }

  const title = `chore: clean up waste (${parts.join(', ')})`;
  const sizeKb = Math.round(result.summary.totalBytesFreed / 1024);
  const sizeStr = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;

  const body = [
    '',
    `Removed ${result.summary.totalFilesRemoved} unused file${result.summary.totalFilesRemoved !== 1 ? 's' : ''} (${sizeStr})`,
    result.unusedDeps.removed.length > 0 ? `Uninstalled ${result.unusedDeps.removed.length} unused package${result.unusedDeps.removed.length !== 1 ? 's' : ''}` : null,
    result.importsRemoved.length > 0 ? `Updated ${result.importsRemoved.length} file${result.importsRemoved.length !== 1 ? 's' : ''} to remove dead imports` : null,
    '',
    'Generated by Swynx',
    'https://swynx.io'
  ].filter(Boolean).join('\n');

  const message = title + '\n' + body;

  try {
    // Stage all changes
    const allDeletedFiles = [
      ...result.deadCode.deleted.map(f => f.file),
      ...result.unusedAssets.deleted.map(f => f.file)
    ];

    for (const file of allDeletedFiles) {
      try {
        execSync(`git add "${file}"`, { cwd: projectPath, stdio: 'pipe' });
      } catch {}
    }

    // Stage modified files
    const modifiedFiles = [
      ...result.importsRemoved.map(i => i.file),
      ...result.exportsRemoved.map(e => e.file)
    ];
    for (const file of modifiedFiles) {
      try {
        execSync(`git add "${file}"`, { cwd: projectPath, stdio: 'pipe' });
      } catch {}
    }

    // Stage package.json if deps were removed
    if (result.unusedDeps.removed.length > 0) {
      try {
        execSync('git add package.json package-lock.json', { cwd: projectPath, stdio: 'pipe' });
      } catch {}
    }

    // Create commit
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: projectPath, stdio: 'pipe' });

    return { success: true, message };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Rollback unified fix
 */
export async function rollbackUnifiedFix(projectPath, snapshotId = null) {
  if (snapshotId) {
    return restoreSnapshot(projectPath, snapshotId);
  }

  const snapshots = listSnapshots(projectPath);
  if (snapshots.length === 0) {
    return { success: false, error: 'No snapshots found' };
  }

  return restoreSnapshot(projectPath, snapshots[0].snapshotId);
}

/**
 * Preview unified fix (dry run)
 */
export async function previewUnifiedFix(projectPath, scanResult, options = {}) {
  return unifiedFix(projectPath, scanResult, { ...options, dryRun: true });
}

export default {
  unifiedFix,
  rollbackUnifiedFix,
  previewUnifiedFix
};
