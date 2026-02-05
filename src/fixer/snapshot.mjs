// src/fixer/snapshot.mjs
// Create rollback snapshots before destructive operations

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { randomUUID } from 'crypto';

const SNAPSHOT_DIR = '.swynx-snapshots';

/**
 * Create a new snapshot before applying fixes
 */
export function createSnapshot(projectPath, files, reason = 'fix') {
  const snapshotId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const snapshotDir = join(projectPath, SNAPSHOT_DIR, snapshotId);

  mkdirSync(snapshotDir, { recursive: true });
  mkdirSync(join(snapshotDir, 'files'), { recursive: true });

  const manifest = {
    snapshotId,
    reason,
    createdAt: new Date().toISOString(),
    projectPath,
    files: [],
    status: 'active',
    fileCount: 0,
    totalSize: 0
  };

  // Copy each file to the snapshot
  for (const filePath of files) {
    const fullPath = join(projectPath, filePath);
    if (!existsSync(fullPath)) continue;

    const snapshotPath = join(snapshotDir, 'files', filePath);
    mkdirSync(dirname(snapshotPath), { recursive: true });

    const stats = statSync(fullPath);
    copyFileSync(fullPath, snapshotPath);

    manifest.files.push({
      originalPath: filePath,
      snapshotPath: relative(snapshotDir, snapshotPath),
      size: stats.size
    });
    manifest.totalSize += stats.size;
  }

  manifest.fileCount = manifest.files.length;
  writeFileSync(join(snapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return { snapshotId, snapshotDir, manifest };
}

/**
 * List all snapshots for a project
 */
export function listSnapshots(projectPath) {
  const snapshotRoot = join(projectPath, SNAPSHOT_DIR);

  if (!existsSync(snapshotRoot)) {
    return [];
  }

  const snapshots = [];
  const entries = readdirSync(snapshotRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const manifestPath = join(snapshotRoot, entry.name, 'manifest.json');
      if (existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
          snapshots.push(manifest);
        } catch (e) {
          // Skip invalid snapshots
        }
      }
    }
  }

  // Sort by creation date (newest first)
  return snapshots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Get the most recent snapshot
 */
export function getLatestSnapshot(projectPath) {
  const snapshots = listSnapshots(projectPath);
  return snapshots[0] || null;
}

/**
 * Get a specific snapshot
 */
export function getSnapshot(projectPath, snapshotId) {
  const manifestPath = join(projectPath, SNAPSHOT_DIR, snapshotId, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

/**
 * Restore files from a snapshot (rollback)
 */
export function restoreSnapshot(projectPath, snapshotId) {
  const snapshotDir = join(projectPath, SNAPSHOT_DIR, snapshotId);
  const manifestPath = join(snapshotDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    throw new Error(`Snapshot ${snapshotId} not found`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const restored = [];
  const errors = [];

  for (const file of manifest.files) {
    try {
      const snapshotPath = join(snapshotDir, file.snapshotPath || join('files', file.originalPath));
      const originalPath = join(projectPath, file.originalPath);

      if (existsSync(snapshotPath)) {
        // Ensure directory exists
        mkdirSync(dirname(originalPath), { recursive: true });
        // Copy back
        copyFileSync(snapshotPath, originalPath);
        restored.push(file.originalPath);
      } else {
        errors.push({ file: file.originalPath, error: 'Snapshot file not found' });
      }
    } catch (error) {
      errors.push({ file: file.originalPath, error: error.message });
    }
  }

  // Update manifest status
  manifest.status = 'restored';
  manifest.restoredAt = new Date().toISOString();
  manifest.restoredFiles = restored.length;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    success: true,
    snapshotId,
    restored,
    errors: errors.length > 0 ? errors : undefined,
    message: `Restored ${restored.length} file(s) from snapshot`
  };
}

/**
 * Delete a snapshot
 */
export function deleteSnapshot(projectPath, snapshotId) {
  const snapshotDir = join(projectPath, SNAPSHOT_DIR, snapshotId);

  if (!existsSync(snapshotDir)) {
    throw new Error(`Snapshot ${snapshotId} not found`);
  }

  const manifestPath = join(snapshotDir, 'manifest.json');
  let fileCount = 0;
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    fileCount = manifest.fileCount || manifest.files?.length || 0;
  }

  rmSync(snapshotDir, { recursive: true, force: true });

  return {
    success: true,
    snapshotId,
    deletedFiles: fileCount,
    message: `Deleted snapshot with ${fileCount} file(s)`
  };
}

export default {
  createSnapshot,
  listSnapshots,
  getLatestSnapshot,
  getSnapshot,
  restoreSnapshot,
  deleteSnapshot
};
