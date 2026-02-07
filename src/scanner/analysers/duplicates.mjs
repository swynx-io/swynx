// src/scanner/analysers/duplicates.mjs
// Duplicate code detection with actual content comparison

import { createHash } from 'crypto';
import { readFileSync } from 'fs';

// Common entry point and boilerplate function names that shouldn't be flagged
const EXCLUDED_FUNCTION_NAMES = new Set([
  'main', 'run', 'start', 'init', 'initialize', 'bootstrap', 'execute',
  'handler', 'callback', 'listener', 'setup', 'teardown', 'cleanup',
  'render', 'update', 'refresh', 'load', 'save', 'fetch',
  'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'describe', 'it', 'test',
  'anonymous', 'default', 'exports', 'constructor'
]);

// Patterns for functions that shouldn't be flagged as duplicates even if similar
// These are intentionally similar by design (UI component patterns, hooks, etc.)
const EXCLUDED_PATTERNS = [
  // React hooks - same name in different files are different hooks (useSidebar in sidebar vs chart vs carousel)
  /^use[A-Z]/,
  // UI component variants - SheetHeader, DialogHeader, DrawerHeader are similar by design
  /Header$/,
  /Footer$/,
  /Content$/,
  /Trigger$/,
  /Close$/,
  /Overlay$/,
  // Icon components
  /Icon$/,
  // Note: Removed get*/set*/is*/has*/format*/parse*/validate* patterns
  // These utility functions SHOULD be flagged as duplicates when copied across files
];

/**
 * Check if a function name matches excluded patterns
 */
function isExcludedPattern(name) {
  if (!name) return false;
  return EXCLUDED_PATTERNS.some(pattern => pattern.test(name));
}

// Minimum function size to consider (avoid flagging tiny helpers)
const MIN_FUNCTION_SIZE = 50; // bytes
const MIN_FUNCTION_LINES = 3;

// Similarity threshold to consider functions as duplicates
const SIMILARITY_THRESHOLD = 0.85; // 85%

// Performance limits for large codebases
const MAX_FUNCTIONS_FOR_NEAR_DUPLICATES = 2000; // Skip O(n²) similarity for large codebases
const MAX_FUNCTIONS_TOTAL = 50000; // Safety limit

/**
 * Find duplicate/similar code blocks by comparing actual content
 */
export async function findDuplicates(jsAnalysis, onProgress = () => {}) {
  const similarBlocks = [];
  const duplicateFunctions = [];

  // Collect all functions with their content
  const allFunctions = [];
  const total = jsAnalysis.length;

  for (let i = 0; i < jsAnalysis.length; i++) {
    const file = jsAnalysis[i];
    const filePath = file.file?.relativePath || file.file;
    // A10 in deadcode.mjs nulls content to free memory; re-read from disk if needed
    let fileContent = file.content || '';
    if (!fileContent && file.file?.path) {
      try { fileContent = readFileSync(file.file.path, 'utf-8'); } catch {}
    }

    // Report progress every 2 files and yield to event loop
    if (i % 2 === 0 || i === total - 1) {
      onProgress({ current: i + 1, total, file: filePath });
      await new Promise(resolve => setImmediate(resolve));
    }

    for (const func of file.functions || []) {
      if (!func.name || typeof func.name !== 'string') continue;
      const nameLower = func.name.toLowerCase();
      if (EXCLUDED_FUNCTION_NAMES.has(nameLower)) {
        continue;
      }

      // Skip functions matching excluded patterns (hooks, UI variants, etc.)
      if (isExcludedPattern(func.name)) {
        continue;
      }

      // Skip tiny functions
      if ((func.sizeBytes || 0) < MIN_FUNCTION_SIZE || (func.lineCount || 0) < MIN_FUNCTION_LINES) {
        continue;
      }

      // Extract function body from file content
      const functionBody = extractFunctionBody(fileContent, func.line, func.endLine);
      if (!functionBody) continue;

      // Normalize the code for comparison
      const normalized = normalizeCode(functionBody);
      const hash = hashCode(normalized);

      allFunctions.push({
        name: func.name,
        file: filePath,
        relativePath: filePath,
        line: func.line,
        endLine: func.endLine,
        lineCount: func.lineCount || 0,
        sizeBytes: func.sizeBytes || 0,
        signature: func.signature || `function ${func.name}()`,
        body: functionBody,
        normalized,
        hash
      });

      // Safety limit to prevent memory exhaustion on huge codebases
      if (allFunctions.length >= MAX_FUNCTIONS_TOTAL) {
        console.error(`[PERF] Hit function limit (${MAX_FUNCTIONS_TOTAL}), stopping collection`);
        break;
      }
    }

    // Also break outer loop if limit reached
    if (allFunctions.length >= MAX_FUNCTIONS_TOTAL) break;
  }

  // Group functions by hash (exact duplicates)
  const hashGroups = new Map();
  for (const func of allFunctions) {
    if (!hashGroups.has(func.hash)) {
      hashGroups.set(func.hash, []);
    }
    hashGroups.get(func.hash).push(func);
  }

  // Find exact duplicates (same hash)
  for (const [hash, funcs] of hashGroups) {
    if (funcs.length > 1) {
      // Filter to only include functions from different files
      // Functions in the same file with same hash are usually export+definition, not duplicates
      const uniqueFiles = new Set(funcs.map(f => f.file));
      if (uniqueFiles.size < 2) {
        // All occurrences are in the same file - skip this group
        continue;
      }

      // Only keep one occurrence per file
      const deduped = [];
      const seenFiles = new Set();
      for (const func of funcs) {
        if (!seenFiles.has(func.file)) {
          seenFiles.add(func.file);
          deduped.push(func);
        }
      }

      if (deduped.length < 2) continue;

      // These are exact duplicates in different files
      const totalSize = deduped.reduce((sum, f) => sum + f.sizeBytes, 0);
      const avgSize = Math.round(totalSize / deduped.length);
      const totalLines = deduped.reduce((sum, f) => sum + f.lineCount, 0);

      duplicateFunctions.push({
        name: deduped[0].name,
        signature: deduped[0].signature,
        occurrences: deduped.map(f => ({
          file: f.file,
          relativePath: f.relativePath,
          line: f.line,
          endLine: f.endLine,
          lineCount: f.lineCount,
          sizeBytes: f.sizeBytes,
          sizeFormatted: formatBytes(f.sizeBytes)
        })),
        count: deduped.length,
        sizeBytes: totalSize,
        sizeFormatted: formatBytes(totalSize),
        avgSizeBytes: avgSize,
        avgSizeFormatted: formatBytes(avgSize),
        totalLines,
        similarity: 100,
        isExactMatch: true,
        recommendation: {
          action: 'Extract to shared module',
          confidence: 'high'
        }
      });
    }
  }

  // Find near-duplicates (similar but not identical) among remaining functions
  // Skip this O(n²) step for large codebases to avoid hanging
  const usedFunctions = new Set(duplicateFunctions.flatMap(d =>
    d.occurrences.map(o => `${o.file}:${o.line}`)
  ));

  const remainingFunctions = allFunctions.filter(f =>
    !usedFunctions.has(`${f.file}:${f.line}`)
  );

  // Only do near-duplicate detection for smaller codebases
  let nearDuplicateGroups = [];
  let skippedNearDuplicates = false;

  if (remainingFunctions.length <= MAX_FUNCTIONS_FOR_NEAR_DUPLICATES) {
    // Compare remaining functions for similarity (O(n²) - only safe for small n)
    nearDuplicateGroups = findNearDuplicates(remainingFunctions);
  } else {
    // Skip for large codebases - exact hash matches are already found above
    skippedNearDuplicates = true;
    console.error(`[PERF] Skipping near-duplicate detection: ${remainingFunctions.length} functions exceeds limit of ${MAX_FUNCTIONS_FOR_NEAR_DUPLICATES}`);
  }

  for (const group of nearDuplicateGroups) {
    if (group.length > 1) {
      const totalSize = group.reduce((sum, f) => sum + f.sizeBytes, 0);
      const avgSize = Math.round(totalSize / group.length);
      const totalLines = group.reduce((sum, f) => sum + f.lineCount, 0);
      const avgSimilarity = Math.round(group.reduce((sum, f) => sum + (f.similarity || 85), 0) / group.length);

      duplicateFunctions.push({
        name: group[0].name || 'Similar functions',
        signature: group[0].signature,
        occurrences: group.map(f => ({
          file: f.file,
          relativePath: f.relativePath,
          line: f.line,
          endLine: f.endLine,
          lineCount: f.lineCount,
          sizeBytes: f.sizeBytes,
          sizeFormatted: formatBytes(f.sizeBytes)
        })),
        count: group.length,
        sizeBytes: totalSize,
        sizeFormatted: formatBytes(totalSize),
        avgSizeBytes: avgSize,
        avgSizeFormatted: formatBytes(avgSize),
        totalLines,
        similarity: avgSimilarity,
        isExactMatch: false,
        recommendation: {
          action: 'Consider consolidating similar logic',
          confidence: avgSimilarity >= 95 ? 'high' : 'medium'
        }
      });
    }
  }

  // Sort by size (largest first)
  duplicateFunctions.sort((a, b) => b.sizeBytes - a.sizeBytes);

  // Calculate total wasted bytes
  const totalDuplicateBytes = duplicateFunctions.reduce((sum, d) => {
    // Waste = total size minus one copy
    return sum + (d.sizeBytes - d.avgSizeBytes);
  }, 0);

  return {
    similarBlocks,
    duplicateFunctions,
    totalBytes: totalDuplicateBytes,
    potentialSavings: formatBytes(totalDuplicateBytes),
    skippedNearDuplicates,
    functionCount: allFunctions.length
  };
}

/**
 * Extract function body from file content using line numbers
 */
function extractFunctionBody(content, startLine, endLine) {
  if (!content || !startLine) return null;

  const lines = content.split('\n');
  const start = Math.max(0, startLine - 1);
  const end = endLine ? Math.min(lines.length, endLine) : start + 1;

  return lines.slice(start, end).join('\n');
}

/**
 * Normalize code for comparison
 * - Remove comments
 * - Normalize whitespace
 * - Remove variable names (replace with placeholders)
 */
function normalizeCode(code) {
  if (!code) return '';

  let normalized = code;

  // Remove single-line comments
  normalized = normalized.replace(/\/\/.*$/gm, '');

  // Remove multi-line comments
  normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, '');

  // Remove string contents (keep quotes to preserve structure)
  normalized = normalized.replace(/'[^']*'/g, "''");
  normalized = normalized.replace(/"[^"]*"/g, '""');
  normalized = normalized.replace(/`[^`]*`/g, '``');

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Remove specific variable/function names (replace identifiers after common keywords)
  // This helps match functions that do the same thing but use different names
  normalized = normalized.replace(/\b(const|let|var|function)\s+\w+/g, '$1 _');
  normalized = normalized.replace(/\.\w+\s*\(/g, '._(');

  return normalized;
}

/**
 * Create hash of normalized code
 */
function hashCode(code) {
  return createHash('md5').update(code).digest('hex');
}

/**
 * Find groups of near-duplicate functions using similarity comparison
 */
function findNearDuplicates(functions) {
  const groups = [];
  const used = new Set();

  for (let i = 0; i < functions.length; i++) {
    if (used.has(i)) continue;

    const group = [functions[i]];
    used.add(i);

    for (let j = i + 1; j < functions.length; j++) {
      if (used.has(j)) continue;

      const similarity = calculateSimilarity(
        functions[i].normalized,
        functions[j].normalized
      );

      if (similarity >= SIMILARITY_THRESHOLD) {
        functions[j].similarity = Math.round(similarity * 100);
        group.push(functions[j]);
        used.add(j);
      }
    }

    if (group.length > 1) {
      groups.push(group);
    }
  }

  return groups;
}

/**
 * Calculate similarity between two normalized code strings
 * Uses a combination of token-based and character-based comparison
 */
function calculateSimilarity(code1, code2) {
  if (!code1 || !code2) return 0;
  if (code1 === code2) return 1;

  // Token-based comparison (split by non-word characters)
  const tokens1 = new Set(code1.split(/\W+/).filter(t => t.length > 1));
  const tokens2 = new Set(code2.split(/\W+/).filter(t => t.length > 1));

  // Jaccard similarity of tokens
  const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
  const union = new Set([...tokens1, ...tokens2]);

  if (union.size === 0) return 0;

  const tokenSimilarity = intersection.size / union.size;

  // Length similarity (penalize very different lengths)
  const lengthRatio = Math.min(code1.length, code2.length) / Math.max(code1.length, code2.length);

  // Combine both metrics
  return (tokenSimilarity * 0.7) + (lengthRatio * 0.3);
}

/**
 * Calculate total duplicate size
 */
export function calculateDuplicateSize(duplicates, jsAnalysis) {
  if (duplicates.totalBytes) {
    return duplicates.totalBytes;
  }

  return duplicates.duplicateFunctions?.reduce((sum, d) => {
    return sum + (d.sizeBytes - (d.avgSizeBytes || 0));
  }, 0) || 0;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

export default { findDuplicates, calculateDuplicateSize };
