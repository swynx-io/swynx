// src/fixer/modules/outdated-deps.mjs
// Fix module for updating outdated dependencies

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { createSession } from '../quarantine.mjs';

export const metadata = {
  id: 'outdated-deps',
  name: 'Update Outdated Dependencies',
  description: 'Updates outdated dependencies to their latest compatible versions (skips major version updates)',
  confidence: 'MEDIUM',
  autoFixable: true,
  category: 'dependencies'
};

/**
 * Analyse outdated dependencies from scan results
 */
export function analyse(scanResult) {
  const outdatedRaw = scanResult.outdated || [];
  // Handle both old array format and new object format
  const outdated = Array.isArray(outdatedRaw) ? outdatedRaw : (outdatedRaw.packages || []);

  return outdated.map(dep => ({
    type: 'outdated-dep',
    name: dep.name,
    current: dep.current,
    wanted: dep.wanted,
    latest: dep.latest,
    updateType: dep.updateType,
    confidence: dep.updateType === 'major' ? 'LOW' : 'MEDIUM',
    autoFixable: dep.updateType !== 'major',
    description: `${dep.name}: ${dep.current} → ${dep.latest} (${dep.updateType})`
  }));
}

/**
 * Preview the fix without applying
 */
export function preview(scanResult) {
  const issues = analyse(scanResult);
  const autoFixable = issues.filter(i => i.autoFixable);
  const majorOnly = issues.filter(i => !i.autoFixable);

  return {
    moduleId: metadata.id,
    issues,
    summary: {
      totalPackages: issues.length,
      autoFixable: autoFixable.length,
      majorOnly: majorOnly.length,
      note: majorOnly.length > 0
        ? `${majorOnly.length} packages have major updates available (manual update recommended)`
        : 'All updates are safe to apply automatically'
    }
  };
}

/**
 * Apply the fix
 */
export async function fix(projectPath, scanResult, options = {}) {
  const issues = analyse(scanResult);

  // Only fix non-major updates by default
  const toUpdate = options.includeMajor
    ? issues
    : issues.filter(i => i.updateType !== 'major');

  if (toUpdate.length === 0) {
    return {
      success: true,
      moduleId: metadata.id,
      fixed: [],
      skipped: issues.filter(i => !i.autoFixable).map(i => ({
        name: i.name,
        reason: 'Major version update - requires manual review'
      })),
      message: 'No safe updates available (only major version updates found)'
    };
  }

  // Dry run mode
  if (options.dryRun) {
    return {
      success: true,
      moduleId: metadata.id,
      dryRun: true,
      wouldUpdate: toUpdate.map(i => ({
        name: i.name,
        from: i.current,
        to: i.wanted
      })),
      command: 'npm update'
    };
  }

  // Create quarantine session for backup
  const session = createSession(projectPath, 'outdated-deps-update');
  const fixed = [];
  const skipped = [];
  const errors = [];

  // Run npm update for each package
  for (const issue of toUpdate) {
    try {
      execSync(`npm update ${issue.name}`, {
        cwd: projectPath,
        stdio: 'pipe',
        timeout: 120000
      });
      fixed.push({
        name: issue.name,
        from: issue.current,
        to: issue.wanted
      });
    } catch (error) {
      skipped.push({ name: issue.name, reason: error.message });
      errors.push({ name: issue.name, error: error.message });
    }
  }

  // Add major-only packages to skipped
  const majorOnly = issues.filter(i => !i.autoFixable);
  for (const issue of majorOnly) {
    skipped.push({
      name: issue.name,
      reason: 'Major version update - requires manual review'
    });
  }

  return {
    success: true,
    moduleId: metadata.id,
    fixed,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
    quarantineSession: session.sessionId,
    note: 'Run npm install to complete updates.'
  };
}

export default { metadata, analyse, preview, fix };
