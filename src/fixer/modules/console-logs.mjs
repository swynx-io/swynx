// src/fixer/modules/console-logs.mjs
// Fix module for removing console.log statements from frontend/client code

import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { createSession, quarantineFile } from '../quarantine.mjs';

export const metadata = {
  id: 'console-logs',
  name: 'Remove Console Logs',
  description: 'Removes console.log statements from frontend components (React, Vue, etc.). Server-side and utility scripts are excluded.',
  confidence: 'LOW',
  autoFixable: true,
  category: 'code'
};

// More conservative pattern that handles complex cases
const SAFE_CONSOLE_PATTERN = /^\s*console\.(log|warn|info|debug|trace)\s*\(.*\);?\s*$/gm;

// WHITELIST approach: Only target files in these frontend directories
// This is much safer than trying to exclude everything
const TARGET_PATTERNS = [
  /\/components\//i,      // React/Vue components
  /\/pages\//i,           // Next.js/Nuxt pages
  /\/views\//i,           // Vue views
  /\/features\//i,        // Feature modules
  /\/app\//i,             // App directory (Next.js 13+)
  /\/widgets\//i,         // Widget components
  /\/containers\//i,      // Container components
  /\/layouts\//i,         // Layout components
  /\/screens\//i,         // React Native screens
  /\/public\/.*\.(js|mjs)$/i,  // Public frontend JS files
  /\/frontend\//i,        // Frontend directories
  /\/client\//i,          // Client-side code
  /\/admin\//i,           // Admin dashboards
  /\/dashboard\//i,       // Dashboard code
  /\.component\.(js|ts|jsx|tsx)$/i,  // Angular components
  /\.page\.(js|ts|jsx|tsx)$/i,       // Page files
];

// Still exclude test files and obvious non-production code
const EXCLUDE_PATTERNS = [
  /\.test\.(js|ts|jsx|tsx)$/,
  /\.spec\.(js|ts|jsx|tsx)$/,
  /__tests__/,
  /node_modules/,
  /\.min\.js$/,
  /\.stories\.(js|ts|jsx|tsx)$/,  // Storybook
  /\.mock\.(js|ts|jsx|tsx)$/,     // Mocks
];

/**
 * Check if file should be targeted (whitelist approach)
 * Only returns true for files in frontend component directories
 */
function shouldTarget(filePath) {
  // First check exclusions
  if (EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath))) {
    return false;
  }

  // Then check if it's in a target directory
  return TARGET_PATTERNS.some(pattern => pattern.test(filePath));
}

/**
 * Count console statements in content
 */
function countConsoleLogs(content) {
  const matches = content.match(SAFE_CONSOLE_PATTERN);
  return matches ? matches.length : 0;
}

/**
 * Remove console statements from content
 */
function removeConsoleLogs(content) {
  // Split into lines and filter
  const lines = content.split('\n');
  const filteredLines = [];
  let removed = 0;

  for (const line of lines) {
    // Check if line is primarily a console statement
    const trimmed = line.trim();
    if (/^console\.(log|warn|info|debug|trace)\s*\(/.test(trimmed)) {
      // Check if it's a complete statement on one line
      if (/\);?\s*$/.test(trimmed) || trimmed.endsWith(',')) {
        removed++;
        continue; // Skip this line
      }
    }
    filteredLines.push(line);
  }

  return {
    content: filteredLines.join('\n'),
    removed
  };
}

/**
 * Analyse console.log usage from scan results
 */
export function analyse(scanResult) {
  const jsAnalysis = scanResult.details?.jsAnalysis || [];
  const issues = [];

  for (const entry of jsAnalysis) {
    // Handle both file object structure and direct path
    const filePath = entry.file?.path || entry.file;
    const relativePath = entry.file?.relativePath || entry.relativePath || filePath;

    // Whitelist approach: only target files in frontend component directories
    if (!filePath || (!shouldTarget(filePath) && !shouldTarget(relativePath))) continue;

    // Check if file content has console statements
    try {
      const content = entry.content || (existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '');
      const count = countConsoleLogs(content);

      if (count > 0) {
        issues.push({
          type: 'console-log',
          file: relativePath,
          fullPath: filePath,
          count,
          confidence: 'LOW',
          autoFixable: true,
          description: `File contains ${count} console statement(s)`
        });
      }
    } catch (e) {
      // Skip files we can't read
    }
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
      totalStatements: issues.reduce((sum, i) => sum + i.count, 0),
      note: 'Only frontend components are targeted. Server/utility scripts excluded.'
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
      message: 'No console statements to remove'
    };
  }

  // Dry run mode
  if (options.dryRun) {
    return {
      success: true,
      moduleId: metadata.id,
      dryRun: true,
      wouldFix: issues.map(i => ({
        file: i.file,
        statements: i.count
      })),
      totalStatements: issues.reduce((sum, i) => sum + i.count, 0)
    };
  }

  // Create quarantine session for backups
  const session = createSession(projectPath, 'console-log-removal');
  const fixed = [];
  const skipped = [];
  const errors = [];
  let totalRemoved = 0;

  for (const issue of issues) {
    try {
      const fullPath = issue.fullPath || join(projectPath, issue.file);

      if (!existsSync(fullPath)) {
        skipped.push({ file: issue.file, reason: 'File not found' });
        continue;
      }

      // Read original content
      const originalContent = readFileSync(fullPath, 'utf-8');

      // Back up to quarantine (copy, don't move, since we're editing not deleting)
      const backupPath = join(projectPath, '.swynx-quarantine', session.sessionId, 'backups', issue.file);
      const backupDir = join(projectPath, '.swynx-quarantine', session.sessionId, 'backups');
      const { mkdirSync } = await import('fs');
      mkdirSync(join(backupDir, ...issue.file.split('/').slice(0, -1)), { recursive: true });
      writeFileSync(backupPath, originalContent);

      // Remove console statements
      const { content: newContent, removed } = removeConsoleLogs(originalContent);

      if (removed > 0) {
        // Write modified content
        writeFileSync(fullPath, newContent);
        totalRemoved += removed;
        fixed.push({
          file: issue.file,
          statementsRemoved: removed
        });
      } else {
        skipped.push({ file: issue.file, reason: 'No statements could be safely removed' });
      }
    } catch (error) {
      skipped.push({ file: issue.file, reason: error.message });
      errors.push({ file: issue.file, error: error.message });
    }
  }

  // Update session manifest with backup info
  const manifestPath = join(projectPath, '.swynx-quarantine', session.sessionId, 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    manifest.backupType = 'console-log-removal';
    manifest.filesModified = fixed.length;
    manifest.statementsRemoved = totalRemoved;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  return {
    success: true,
    moduleId: metadata.id,
    fixed,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
    quarantineSession: session.sessionId,
    totalStatementsRemoved: totalRemoved,
    note: 'Original files backed up to quarantine.'
  };
}

export default { metadata, analyse, preview, fix };
