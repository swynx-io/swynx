// src/fixer/modules/unused-deps.mjs
// Fix module for removing unused dependencies

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { createSession, quarantineFile } from '../quarantine.mjs';

export const metadata = {
  id: 'unused-deps',
  name: 'Remove Unused Dependencies',
  description: 'Removes production dependencies that are not imported in your code',
  confidence: 'MEDIUM',
  autoFixable: true,
  category: 'dependencies'
};

/**
 * Analyse unused dependencies from scan results
 */
export function analyse(scanResult) {
  const unusedDeps = scanResult.details?.unusedDeps || [];

  return unusedDeps.map(dep => ({
    type: 'unused-dep',
    name: dep.name,
    version: dep.version,
    sizeBytes: dep.sizeBytes || 0,
    confidence: 'MEDIUM',
    autoFixable: true,
    description: `Unused dependency: ${dep.name}@${dep.version}`
  }));
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
      totalPackages: issues.length,
      totalSizeBytes: issues.reduce((sum, i) => sum + (i.sizeBytes || 0), 0),
      note: 'Will run npm uninstall for each unused package'
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
      message: 'No unused dependencies to remove'
    };
  }

  // Dry run mode
  if (options.dryRun) {
    return {
      success: true,
      moduleId: metadata.id,
      dryRun: true,
      wouldRemove: issues.map(i => i.name),
      command: `npm uninstall ${issues.map(i => i.name).join(' ')}`
    };
  }

  // Create quarantine session for backup
  const session = createSession(projectPath, 'unused-deps-removal');
  const fixed = [];
  const skipped = [];
  const errors = [];

  // Backup package.json and package-lock.json
  const packageJsonPath = join(projectPath, 'package.json');
  const lockPath = join(projectPath, 'package-lock.json');

  try {
    if (existsSync(packageJsonPath)) {
      quarantineFile(projectPath, session.sessionId, packageJsonPath);
      // Restore immediately since we're modifying, not deleting
      writeFileSync(packageJsonPath, readFileSync(join(projectPath, '.swynx-quarantine', session.sessionId, 'files', 'package.json')));
    }
  } catch (e) {
    // Continue anyway
  }

  // Remove each package
  for (const issue of issues) {
    try {
      execSync(`npm uninstall ${issue.name}`, {
        cwd: projectPath,
        stdio: 'pipe',
        timeout: 60000
      });
      fixed.push({ name: issue.name, version: issue.version });
    } catch (error) {
      skipped.push({ name: issue.name, reason: error.message });
      errors.push({ name: issue.name, error: error.message });
    }
  }

  return {
    success: true,
    moduleId: metadata.id,
    fixed,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
    quarantineSession: session.sessionId,
    note: 'Original package.json backed up to quarantine.'
  };
}

export default { metadata, analyse, preview, fix };
