// src/fixer/deleter.mjs
// Safely delete dead files with optional empty directory cleanup

import { existsSync, unlinkSync, rmdirSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { createSnapshot } from './snapshot.mjs';

/**
 * Delete dead files from disk
 * @param {string} projectPath - Project root
 * @param {string[]} files - List of relative file paths to delete
 * @param {object} options - Options
 * @returns {object} Result with deleted files and errors
 */
export async function deleteFiles(projectPath, files, options = {}) {
  const {
    dryRun = false,
    createBackup = true,
    cleanEmptyDirs = true
  } = options;

  const result = {
    deleted: [],
    skipped: [],
    errors: [],
    emptyDirsRemoved: [],
    snapshotId: null
  };

  if (files.length === 0) {
    return result;
  }

  // Create snapshot before deletion if not dry run
  if (!dryRun && createBackup) {
    try {
      const snapshot = createSnapshot(projectPath, files, 'dead-code-fix');
      result.snapshotId = snapshot.snapshotId;
    } catch (error) {
      result.errors.push({ type: 'snapshot', error: error.message });
      // Continue anyway - user can still use git for recovery
    }
  }

  // Delete files
  for (const file of files) {
    const fullPath = join(projectPath, file);

    if (!existsSync(fullPath)) {
      result.skipped.push({ file, reason: 'not found' });
      continue;
    }

    if (dryRun) {
      result.deleted.push({ file, dryRun: true });
      continue;
    }

    try {
      unlinkSync(fullPath);
      result.deleted.push({ file });
    } catch (error) {
      result.errors.push({ file, error: error.message });
    }
  }

  // Clean up empty directories
  if (!dryRun && cleanEmptyDirs) {
    const dirsToCheck = new Set();

    // Collect parent directories of deleted files
    for (const { file } of result.deleted) {
      let dir = dirname(file);
      while (dir && dir !== '.' && dir !== '/') {
        dirsToCheck.add(dir);
        dir = dirname(dir);
      }
    }

    // Sort by depth (deepest first) to remove nested empty dirs first
    const sortedDirs = [...dirsToCheck].sort((a, b) =>
      b.split('/').length - a.split('/').length
    );

    for (const dir of sortedDirs) {
      const fullDir = join(projectPath, dir);
      if (existsSync(fullDir)) {
        try {
          const contents = readdirSync(fullDir);
          if (contents.length === 0) {
            rmdirSync(fullDir);
            result.emptyDirsRemoved.push(dir);
          }
        } catch (error) {
          // Directory not empty or permission issue - that's fine
        }
      }
    }
  }

  return result;
}

/**
 * Preview what would be deleted without doing it
 */
export function previewDelete(projectPath, files) {
  const preview = {
    wouldDelete: [],
    notFound: [],
    totalBytes: 0
  };

  for (const file of files) {
    const fullPath = join(projectPath, file);

    if (!existsSync(fullPath)) {
      preview.notFound.push(file);
      continue;
    }

    try {
      const stats = statSync(fullPath);
      preview.wouldDelete.push({
        file,
        size: stats.size
      });
      preview.totalBytes += stats.size;
    } catch (error) {
      preview.notFound.push(file);
    }
  }

  return preview;
}

export default {
  deleteFiles,
  previewDelete
};
