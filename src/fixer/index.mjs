// src/fixer/index.mjs
// Fix Orchestrator - coordinates all fix modules with quarantine safety

import unusedDeps from './modules/unused-deps.mjs';
import outdatedDeps from './modules/outdated-deps.mjs';
import deadCode from './modules/dead-code.mjs';
import optimizeImages from './modules/optimize-images.mjs';
import consoleLogs from './modules/console-logs.mjs';
import { listSessions, getSession } from './quarantine.mjs';

// All available fix modules
export const modules = {
  'unused-deps': unusedDeps,
  'outdated-deps': outdatedDeps,
  'dead-code': deadCode,
  'optimize-images': optimizeImages,
  'console-logs': consoleLogs
};

// Confidence levels
export const CONFIDENCE = {
  HIGH: 'HIGH',     // Safe to auto-fix
  MEDIUM: 'MEDIUM', // Review recommended
  LOW: 'LOW'        // Manual fix only
};

/**
 * List all available fix modules
 */
export function listModules() {
  return Object.entries(modules).map(([id, mod]) => ({
    id,
    name: mod.metadata.name,
    description: mod.metadata.description,
    confidence: mod.metadata.confidence,
    autoFixable: mod.metadata.autoFixable,
    category: mod.metadata.category
  }));
}

/**
 * Get a specific module by ID
 */
export function getModule(moduleId) {
  return modules[moduleId] || null;
}

/**
 * Analyse all fixable issues in a scan
 */
export function analyseAll(scanResult, options = {}) {
  const results = {};
  const summary = {
    totalIssues: 0,
    byModule: {},
    byConfidence: { HIGH: 0, MEDIUM: 0, LOW: 0 },
    autoFixable: 0,
    estimatedSavings: 0
  };

  for (const [moduleId, mod] of Object.entries(modules)) {
    // Skip modules if filtered
    if (options.modules && !options.modules.includes(moduleId)) {
      continue;
    }

    try {
      const issues = mod.analyse(scanResult);
      results[moduleId] = {
        module: mod.metadata,
        issues,
        count: issues.length
      };

      summary.totalIssues += issues.length;
      summary.byModule[moduleId] = issues.length;

      for (const issue of issues) {
        summary.byConfidence[issue.confidence]++;
        if (issue.autoFixable) {
          summary.autoFixable++;
        }
        summary.estimatedSavings += issue.sizeBytes || issue.potentialSavings || 0;
      }
    } catch (error) {
      results[moduleId] = {
        module: mod.metadata,
        error: error.message,
        issues: [],
        count: 0
      };
    }
  }

  return { results, summary };
}

/**
 * Preview all fixes without applying
 */
export function previewAll(scanResult, options = {}) {
  const previews = {};

  for (const [moduleId, mod] of Object.entries(modules)) {
    if (options.modules && !options.modules.includes(moduleId)) {
      continue;
    }

    try {
      previews[moduleId] = mod.preview(scanResult, options);
    } catch (error) {
      previews[moduleId] = {
        moduleId,
        error: error.message,
        issues: []
      };
    }
  }

  return previews;
}

/**
 * Preview a specific fix module
 */
export function previewModule(moduleId, scanResult, options = {}) {
  const mod = modules[moduleId];
  if (!mod) {
    throw new Error(`Unknown fix module: ${moduleId}`);
  }

  return mod.preview(scanResult, options);
}

/**
 * Apply a specific fix module
 */
export async function applyFix(projectPath, moduleId, scanResult, options = {}) {
  const mod = modules[moduleId];
  if (!mod) {
    throw new Error(`Unknown fix module: ${moduleId}`);
  }

  // Check confidence level
  if (!options.force) {
    const confidence = mod.metadata.confidence;
    if (confidence === 'LOW' && !options.allowLowConfidence) {
      return {
        success: false,
        moduleId,
        error: 'This fix has LOW confidence. Use --force or --allow-low-confidence to apply.',
        recommendation: 'Review the changes manually before applying.'
      };
    }
  }

  return await mod.fix(projectPath, scanResult, options);
}

/**
 * Apply multiple fixes
 */
export async function applyFixes(projectPath, moduleIds, scanResult, options = {}) {
  const results = {
    applied: [],
    skipped: [],
    errors: [],
    quarantineSessions: []
  };

  for (const moduleId of moduleIds) {
    try {
      const result = await applyFix(projectPath, moduleId, scanResult, options);

      if (result.success) {
        results.applied.push({
          moduleId,
          ...result
        });
        if (result.quarantineSession) {
          results.quarantineSessions.push(result.quarantineSession);
        }
      } else {
        results.skipped.push({
          moduleId,
          reason: result.error || result.message
        });
      }
    } catch (error) {
      results.errors.push({
        moduleId,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Apply all auto-fixable issues
 */
export async function autoFix(projectPath, scanResult, options = {}) {
  // Get modules that are auto-fixable with HIGH confidence
  const autoFixableModules = Object.entries(modules)
    .filter(([_, mod]) => mod.metadata.autoFixable && mod.metadata.confidence === 'HIGH')
    .map(([id, _]) => id);

  // Allow medium confidence if specified
  if (options.includeMedium) {
    const mediumModules = Object.entries(modules)
      .filter(([_, mod]) => mod.metadata.autoFixable && mod.metadata.confidence === 'MEDIUM')
      .map(([id, _]) => id);
    autoFixableModules.push(...mediumModules);
  }

  // Filter by specified modules if provided
  let modulesToRun = autoFixableModules;
  if (options.modules) {
    modulesToRun = autoFixableModules.filter(m => options.modules.includes(m));
  }

  return await applyFixes(projectPath, modulesToRun, scanResult, options);
}

/**
 * Get fix status for dashboard
 */
export function getFixStatus(projectPath, scanResult) {
  const analysis = analyseAll(scanResult);
  const sessions = listSessions(projectPath);

  return {
    analysis: analysis.summary,
    modules: Object.entries(analysis.results).map(([id, data]) => ({
      id,
      name: data.module.name,
      confidence: data.module.confidence,
      autoFixable: data.module.autoFixable,
      issueCount: data.count,
      issues: data.issues.slice(0, 10) // Limit for dashboard
    })),
    recentQuarantineSessions: sessions.slice(0, 5)
  };
}

export default {
  modules,
  CONFIDENCE,
  listModules,
  getModule,
  analyseAll,
  previewAll,
  previewModule,
  applyFix,
  applyFixes,
  autoFix,
  getFixStatus
};
