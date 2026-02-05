// src/fixer/modules/optimize-images.mjs
// Fix module for optimizing images

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { createSession } from '../quarantine.mjs';

export const metadata = {
  id: 'optimize-images',
  name: 'Optimize Images',
  description: 'Suggests image optimization opportunities (conversion to WebP, compression)',
  confidence: 'LOW',
  autoFixable: false, // Requires external tools
  category: 'assets'
};

/**
 * Analyse image optimization opportunities from scan results
 */
export function analyse(scanResult) {
  const assetOptimisation = scanResult.details?.assetOptimisation || {};
  const issues = [];

  for (const asset of assetOptimisation.optimizable || []) {
    issues.push({
      type: 'image-optimization',
      file: asset.file,
      currentSize: asset.currentSize,
      potentialSavings: asset.potentialSavings,
      suggestion: asset.suggestion,
      confidence: 'LOW',
      autoFixable: false,
      description: `${asset.file}: ${formatBytes(asset.currentSize)} → ~${formatBytes(asset.currentSize - asset.potentialSavings)} (${asset.suggestion})`
    });
  }

  return issues;
}

/**
 * Format bytes to human-readable
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
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
      totalImages: issues.length,
      potentialSavings: issues.reduce((sum, i) => sum + (i.potentialSavings || 0), 0),
      note: 'Image optimization requires external tools (sharp, imagemin). Run manually or install optimization pipeline.'
    }
  };
}

/**
 * Apply the fix (manual operation)
 */
export async function fix(projectPath, scanResult, options = {}) {
  const issues = analyse(scanResult);

  if (issues.length === 0) {
    return {
      success: true,
      moduleId: metadata.id,
      fixed: [],
      skipped: [],
      message: 'No images to optimize'
    };
  }

  // This module doesn't auto-fix - it provides recommendations
  return {
    success: true,
    moduleId: metadata.id,
    fixed: [],
    skipped: issues.map(i => ({
      file: i.file,
      reason: 'Manual optimization required'
    })),
    recommendations: issues.map(i => ({
      file: i.file,
      action: i.suggestion,
      potentialSavings: i.potentialSavings
    })),
    message: 'Image optimization requires manual intervention. Install sharp or imagemin for automated optimization.',
    commands: [
      'npm install sharp',
      'npx sharp-cli --input "*.png" --output webp --format webp'
    ]
  };
}

export default { metadata, analyse, preview, fix };
