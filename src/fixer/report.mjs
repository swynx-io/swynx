// src/fixer/report.mjs
// Generate reports for fix operations

import chalk from 'chalk';

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Generate console report for fix results
 */
export function consoleReport(result, options = {}) {
  const { dryRun = false, verbose = false } = options;
  const lines = [];

  // Header
  if (dryRun) {
    lines.push(chalk.yellow('\n━━━ DRY RUN: Fix Preview ━━━\n'));
  } else {
    lines.push(chalk.green('\n━━━ Fix Applied ━━━\n'));
  }

  // Deleted files
  const deleted = result.deleted || [];
  if (deleted.length > 0) {
    lines.push(chalk.bold(`Files ${dryRun ? 'to be ' : ''}removed: `) + chalk.red(deleted.length));

    if (verbose) {
      for (const item of deleted.slice(0, 20)) {
        const file = item.file || item;
        const size = item.size ? ` (${formatBytes(item.size)})` : '';
        lines.push(`  ${chalk.red('−')} ${file}${size}`);
      }
      if (deleted.length > 20) {
        lines.push(chalk.dim(`  ... and ${deleted.length - 20} more`));
      }
    }
    lines.push('');
  }

  // Modified files (import cleanups)
  const modified = result.importsRemoved || [];
  if (modified.length > 0) {
    lines.push(chalk.bold(`Files ${dryRun ? 'to be ' : ''}updated: `) + chalk.yellow(modified.length));

    if (verbose) {
      for (const item of modified.slice(0, 10)) {
        lines.push(`  ${chalk.yellow('~')} ${item.file}`);
        for (const imp of item.imports || []) {
          lines.push(chalk.dim(`      - ${imp.importPath}`));
        }
      }
      if (modified.length > 10) {
        lines.push(chalk.dim(`  ... and ${modified.length - 10} more files`));
      }
    }
    lines.push('');
  }

  // Barrel exports cleaned
  const barrels = result.exportsRemoved || [];
  if (barrels.length > 0) {
    lines.push(chalk.bold(`Barrel files ${dryRun ? 'to be ' : ''}cleaned: `) + chalk.yellow(barrels.length));

    if (verbose) {
      for (const item of barrels) {
        lines.push(`  ${chalk.yellow('~')} ${item.file}`);
        for (const exp of item.exports || []) {
          lines.push(chalk.dim(`      - ${exp.exportPath}`));
        }
      }
    }
    lines.push('');
  }

  // Empty directories
  const emptyDirs = result.emptyDirsRemoved || [];
  if (emptyDirs.length > 0) {
    lines.push(chalk.bold(`Empty directories ${dryRun ? 'to be ' : ''}removed: `) + chalk.dim(emptyDirs.length));
    lines.push('');
  }

  // Skipped files
  const skipped = result.skipped || [];
  if (skipped.length > 0 && verbose) {
    lines.push(chalk.dim(`Skipped: ${skipped.length} file(s)`));
    for (const item of skipped.slice(0, 5)) {
      lines.push(chalk.dim(`  ⊘ ${item.file || item}: ${item.reason}`));
    }
    lines.push('');
  }

  // Errors
  const errors = result.errors || [];
  if (errors.length > 0) {
    lines.push(chalk.red(`Errors: ${errors.length}`));
    for (const err of errors) {
      lines.push(chalk.red(`  ✗ ${err.file || err.type}: ${err.error}`));
    }
    lines.push('');
  }

  // Git commit
  if (result.commit) {
    if (result.commit.success) {
      lines.push(chalk.green('✓ Git commit created'));
      if (verbose) {
        lines.push(chalk.dim(`  ${result.commit.message?.split('\n')[0]}`));
      }
    } else if (result.commit.dryRun) {
      lines.push(chalk.yellow('○ Git commit would be created'));
    } else if (result.commit.error) {
      lines.push(chalk.red(`✗ Git commit failed: ${result.commit.error}`));
    }
    lines.push('');
  }

  // Snapshot/rollback info
  if (result.snapshotId) {
    lines.push(chalk.cyan(`Snapshot created: ${result.snapshotId}`));
    lines.push(chalk.dim(`  Rollback with: swynx rollback`));
    lines.push('');
  }

  // Summary
  const totalRemoved = deleted.length;
  const totalModified = modified.length + barrels.length;
  const totalBytes = deleted.reduce((sum, d) => sum + (d.size || 0), 0);

  lines.push(chalk.bold('Summary:'));
  lines.push(`  ${dryRun ? 'Would remove' : 'Removed'}: ${totalRemoved} file${totalRemoved !== 1 ? 's' : ''} (${formatBytes(totalBytes)})`);
  if (totalModified > 0) {
    lines.push(`  ${dryRun ? 'Would update' : 'Updated'}: ${totalModified} file${totalModified !== 1 ? 's' : ''}`);
  }

  return lines.join('\n');
}

/**
 * Generate JSON report for fix results
 */
export function jsonReport(result, options = {}) {
  return JSON.stringify({
    success: !result.errors?.length,
    dryRun: options.dryRun || false,
    deleted: result.deleted || [],
    modified: result.importsRemoved || [],
    barrelsUpdated: result.exportsRemoved || [],
    emptyDirsRemoved: result.emptyDirsRemoved || [],
    skipped: result.skipped || [],
    errors: result.errors || [],
    snapshotId: result.snapshotId,
    commit: result.commit,
    summary: {
      filesRemoved: (result.deleted || []).length,
      filesModified: (result.importsRemoved || []).length + (result.exportsRemoved || []).length,
      totalBytes: (result.deleted || []).reduce((sum, d) => sum + (d.size || 0), 0)
    }
  }, null, 2);
}

export default {
  consoleReport,
  jsonReport
};
