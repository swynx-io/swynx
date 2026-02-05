// src/fixer/modules/dead-code.mjs
// Fix module for removing dead/unused code

import { existsSync } from 'fs';
import { join } from 'path';
import { createSession, quarantineFile } from '../quarantine.mjs';

export const metadata = {
  id: 'dead-code',
  name: 'Remove Dead Code',
  description: 'Removes files that appear to be unused (not imported anywhere)',
  confidence: 'LOW',
  autoFixable: true,
  category: 'code'
};

/**
 * Analyse dead code from scan results
 */
export function analyse(scanResult) {
  const deadCode = scanResult.details?.deadCode || {};
  const issues = [];

  // Orphan files (files not imported anywhere)
  for (const orphan of deadCode.orphanFiles || []) {
    issues.push({
      type: 'orphan-file',
      file: orphan.file,
      reason: orphan.reason,
      exports: orphan.exports,
      confidence: 'LOW',
      autoFixable: true,
      description: `Potentially unused file: ${orphan.file}`
    });
  }

  return issues;
}

/**
 * Preview the fix without applying
 */
export function preview(scanResult) {
  const issues = analyse(scanResult);

  return {
    moduleId: metadata.id,
    issues,
    summary: {
      totalFiles: issues.length,
      note: 'Files will be moved to quarantine, not permanently deleted. Review carefully before applying.'
    }
  };
}

/**
 * Apply the fix
 */
export async function fix(projectPath, scanResult, options = {}) {
  const issues = analyse(scanResult);

  if (issues.length === 0) {
    return {
      success: true,
      moduleId: metadata.id,
      fixed: [],
      skipped: [],
      message: 'No dead code files to remove'
    };
  }

  // Dry run mode
  if (options.dryRun) {
    return {
      success: true,
      moduleId: metadata.id,
      dryRun: true,
      wouldRemove: issues.map(i => i.file)
    };
  }

  // Create quarantine session
  const session = createSession(projectPath, 'dead-code-removal');
  const fixed = [];
  const skipped = [];
  const errors = [];

  for (const issue of issues) {
    try {
      const fullPath = join(projectPath, issue.file);

      if (!existsSync(fullPath)) {
        skipped.push({ file: issue.file, reason: 'File not found' });
        continue;
      }

      // Move to quarantine
      quarantineFile(projectPath, session.sessionId, fullPath);
      fixed.push({ file: issue.file, reason: issue.reason });
    } catch (error) {
      skipped.push({ file: issue.file, reason: error.message });
      errors.push({ file: issue.file, error: error.message });
    }
  }

  return {
    success: true,
    moduleId: metadata.id,
    fixed,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
    quarantineSession: session.sessionId,
    totalFilesRemoved: fixed.length,
    note: 'Files moved to quarantine. Use quarantine restore to undo.'
  };
}

export default { metadata, analyse, preview, fix };
