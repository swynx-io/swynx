// src/fixer/apply-fix.mjs
// Main entry point for --fix functionality

import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { deleteFiles, previewDelete } from './deleter.mjs';
import { cleanDeadImports } from './import-cleaner.mjs';
import { cleanBarrelExports } from './barrel-cleaner.mjs';
import { commitFix } from './git.mjs';
import { consoleReport, jsonReport } from './report.mjs';
import { listSnapshots, getLatestSnapshot, restoreSnapshot } from './snapshot.mjs';

/**
 * Apply fix to remove dead files
 * @param {string} projectPath - Project root
 * @param {object} scanResult - Scan results from reporter shape
 * @param {object} options - Options
 */
export async function applyFix(projectPath, scanResult, options = {}) {
  const {
    dryRun = false,
    minConfidence = 0,
    noImportClean = false,
    noBarrelClean = false,
    noGitCommit = false,
    verbose = false
  } = options;

  const result = {
    deleted: [],
    skipped: [],
    errors: [],
    emptyDirsRemoved: [],
    importsRemoved: [],
    exportsRemoved: [],
    snapshotId: null,
    commit: null
  };

  // Get dead files from scan result
  let deadFiles = scanResult.deadFiles || [];

  // Filter by AI confidence if available
  if (minConfidence > 0) {
    deadFiles = deadFiles.filter(f => {
      const confidence = f.aiConfidence ?? f.confidence ?? 1;
      return confidence >= minConfidence;
    });
  }

  // Get file paths
  const filePaths = deadFiles.map(f => f.path || f.file);

  if (filePaths.length === 0) {
    return {
      ...result,
      message: 'No dead files to remove'
    };
  }

  // Add size info to result
  for (const file of deadFiles) {
    const fullPath = join(projectPath, file.path || file.file);
    let size = file.size || 0;

    if (!size && existsSync(fullPath)) {
      try {
        size = statSync(fullPath).size;
      } catch {}
    }

    result.deleted.push({
      file: file.path || file.file,
      size,
      dryRun
    });
  }

  // Calculate total size before preview
  const totalBytes = result.deleted.reduce((sum, d) => sum + (d.size || 0), 0);

  // Dry run - just preview
  if (dryRun) {
    // Get list of live files for import cleaning preview
    const liveFiles = await getLiveFiles(projectPath, filePaths);

    if (!noImportClean) {
      const importCleanResult = await cleanDeadImports(projectPath, filePaths, liveFiles, { dryRun: true });
      result.importsRemoved = importCleanResult.importsRemoved;
    }

    if (!noBarrelClean) {
      const barrelCleanResult = await cleanBarrelExports(projectPath, filePaths, liveFiles, { dryRun: true });
      result.exportsRemoved = barrelCleanResult.exportsRemoved;
    }

    if (!noGitCommit) {
      result.commit = {
        dryRun: true,
        wouldCommit: {
          deletedCount: filePaths.length,
          modifiedCount: result.importsRemoved.length + result.exportsRemoved.length
        }
      };
    }

    return result;
  }

  // Actually delete files (creates snapshot automatically)
  const deleteResult = await deleteFiles(projectPath, filePaths, {
    dryRun: false,
    createBackup: true,
    cleanEmptyDirs: true
  });

  result.deleted = deleteResult.deleted;
  result.skipped = deleteResult.skipped;
  result.errors = deleteResult.errors;
  result.emptyDirsRemoved = deleteResult.emptyDirsRemoved;
  result.snapshotId = deleteResult.snapshotId;

  // Get list of live files for import cleaning
  const liveFiles = await getLiveFiles(projectPath, filePaths);

  // Clean dead imports from live files
  if (!noImportClean) {
    const importCleanResult = await cleanDeadImports(projectPath, filePaths, liveFiles, { dryRun: false });
    result.importsRemoved = importCleanResult.importsRemoved;
    result.errors.push(...importCleanResult.errors);
  }

  // Clean barrel exports
  if (!noBarrelClean) {
    const barrelCleanResult = await cleanBarrelExports(projectPath, filePaths, liveFiles, { dryRun: false });
    result.exportsRemoved = barrelCleanResult.exportsRemoved;
    result.errors.push(...barrelCleanResult.errors);
  }

  // Collect modified files for git
  const modifiedFiles = [
    ...result.importsRemoved.map(i => i.file),
    ...result.exportsRemoved.map(e => e.file)
  ];
  result.filesModified = modifiedFiles;

  // Git commit
  if (!noGitCommit && (result.deleted.length > 0 || modifiedFiles.length > 0)) {
    result.commit = await commitFix(projectPath, {
      deleted: result.deleted,
      filesModified: modifiedFiles
    });
  }

  return result;
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
 * Rollback the most recent fix
 */
export async function rollback(projectPath, snapshotId = null) {
  // Get snapshot to restore
  let snapshot;

  if (snapshotId) {
    snapshot = await import('./snapshot.mjs').then(m => m.getSnapshot(projectPath, snapshotId));
    if (!snapshot) {
      return { success: false, error: `Snapshot ${snapshotId} not found` };
    }
  } else {
    snapshot = await import('./snapshot.mjs').then(m => m.getLatestSnapshot(projectPath));
    if (!snapshot) {
      return { success: false, error: 'No snapshots found. Nothing to rollback.' };
    }
    snapshotId = snapshot.snapshotId;
  }

  // Restore the snapshot
  return restoreSnapshot(projectPath, snapshotId);
}

/**
 * List available snapshots for rollback
 */
export async function listRollbackSnapshots(projectPath) {
  return listSnapshots(projectPath);
}

/**
 * Generate report for fix results
 */
export function generateReport(result, options = {}) {
  const { format = 'console' } = options;

  if (format === 'json') {
    return jsonReport(result, options);
  }

  return consoleReport(result, options);
}

export default {
  applyFix,
  rollback,
  listRollbackSnapshots,
  generateReport
};
