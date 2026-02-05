// src/rules/index.mjs

import { checkHeavyDeps } from './heavy-deps.mjs';
import { checkUnusedDeps } from './unused-deps.mjs';
import { checkUnusedCode } from './unused-code.mjs';
import { getAlternatives } from './alternatives.mjs';

/**
 * Apply all rules to analysis results
 */
export function applyRules(analysis, rulesConfig = {}) {
  const findings = [];

  // Heavy dependencies check
  const heavyDepFindings = checkHeavyDeps(analysis.dependencies, rulesConfig);
  findings.push(...heavyDepFindings);

  // Unused dependencies check
  const unusedDepFindings = checkUnusedDeps(analysis.unusedDeps, rulesConfig);
  findings.push(...unusedDepFindings);

  // Dead code check
  const deadCodeFindings = checkUnusedCode(analysis.deadCode, rulesConfig);
  findings.push(...deadCodeFindings);

  // Duplicate code check
  if (analysis.duplicates) {
    for (const dup of analysis.duplicates.exactDuplicates || []) {
      findings.push({
        rule: 'no-duplicate-files',
        severity: getSeverity('no-duplicate-files', rulesConfig, 'warning'),
        category: 'duplicates',
        message: `Duplicate files found: ${dup.files.map(f => f.split('/').pop()).join(', ')}`,
        files: dup.files,
        sizeImpactBytes: dup.sizeBytes,
        recommendation: 'Remove duplicate files and update imports'
      });
    }

    for (const dup of analysis.duplicates.duplicateFunctions || []) {
      findings.push({
        rule: 'no-duplicate-functions',
        severity: getSeverity('no-duplicate-functions', rulesConfig, 'info'),
        category: 'duplicates',
        message: `Duplicate function: ${dup.name} (${dup.lineCount} lines)`,
        locations: dup.locations,
        recommendation: 'Extract to a shared utility function'
      });
    }
  }

  // Asset optimisation checks
  if (analysis.assetOptimisation) {
    for (const issue of analysis.assetOptimisation.issues || []) {
      const ruleName = issue.type === 'large-png' || issue.type === 'large-jpeg'
        ? 'max-image-size'
        : issue.type === 'no-webp'
        ? 'require-webp'
        : issue.type;

      findings.push({
        rule: ruleName,
        severity: getSeverity(ruleName, rulesConfig, issue.severity),
        category: 'assets',
        message: issue.message,
        filePath: issue.file,
        sizeImpactBytes: issue.sizeBytes,
        recommendation: getAssetRecommendation(issue.type)
      });
    }
  }

  // Unused assets check
  if (analysis.unusedAssets?.length > 0) {
    const totalSize = analysis.unusedAssets.reduce((sum, a) => sum + a.sizeBytes, 0);

    findings.push({
      rule: 'no-unused-assets',
      severity: getSeverity('no-unused-assets', rulesConfig, 'warning'),
      category: 'assets',
      message: `${analysis.unusedAssets.length} unused assets found (${formatBytes(totalSize)})`,
      files: analysis.unusedAssets.map(a => a.file),
      sizeImpactBytes: totalSize,
      recommendation: 'Remove unused assets or verify they are used dynamically'
    });
  }

  // Bundle size checks
  if (analysis.bundles?.bundles) {
    for (const bundle of analysis.bundles.bundles) {
      if (bundle.sizeBytes > 500 * 1024) { // > 500KB
        findings.push({
          rule: 'max-bundle-size',
          severity: getSeverity('max-bundle-size', rulesConfig, 'warning'),
          category: 'bundles',
          message: `Large bundle: ${bundle.name} (${formatBytes(bundle.sizeBytes)})`,
          filePath: bundle.path,
          sizeImpactBytes: bundle.sizeBytes,
          recommendation: 'Consider code splitting or lazy loading'
        });
      }

      if (bundle.analysis.hasMoment) {
        findings.push({
          rule: 'no-moment',
          severity: getSeverity('no-moment', rulesConfig, 'error'),
          category: 'dependencies',
          message: `moment.js detected in bundle: ${bundle.name}`,
          filePath: bundle.path,
          alternatives: getAlternatives('moment'),
          recommendation: 'Replace with date-fns or dayjs for smaller bundle size'
        });
      }

      if (bundle.analysis.hasLodash) {
        findings.push({
          rule: 'no-lodash-full',
          severity: getSeverity('no-lodash-full', rulesConfig, 'warning'),
          category: 'dependencies',
          message: `Full lodash detected in bundle: ${bundle.name}`,
          filePath: bundle.path,
          alternatives: getAlternatives('lodash'),
          recommendation: 'Use lodash-es with tree-shaking or native methods'
        });
      }
    }
  }

  return findings;
}

/**
 * Get severity from config or use default
 */
function getSeverity(rule, config, defaultSeverity) {
  if (!config || !config[rule]) return defaultSeverity;

  const ruleConfig = config[rule];
  if (typeof ruleConfig === 'string') {
    return ruleConfig === 'off' ? null : ruleConfig;
  }
  if (Array.isArray(ruleConfig)) {
    return ruleConfig[0] === 'off' ? null : ruleConfig[0];
  }
  return defaultSeverity;
}

/**
 * Get recommendation for asset issue
 */
function getAssetRecommendation(issueType) {
  const recommendations = {
    'large-png': 'Compress PNG or convert to WebP format',
    'large-jpeg': 'Compress JPEG or convert to WebP format',
    'no-webp': 'Convert to WebP for 25-34% smaller file size',
    'oversized-image': 'Resize image to appropriate dimensions for web',
    'unoptimised-font': 'Convert to WOFF2 format for better compression',
    'large-font': 'Subset font to include only needed characters'
  };

  return recommendations[issueType] || 'Optimise asset';
}

/**
 * Format bytes
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

export default applyRules;
