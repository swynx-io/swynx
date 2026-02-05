// src/scanner/parsers/css.mjs
// CSS parser

import { readFileSync, existsSync } from 'fs';

/**
 * Parse a CSS file
 */
export async function parseCSS(file) {
  const filePath = typeof file === 'string' ? file : file.path;
  const relativePath = typeof file === 'string' ? file : file.relativePath;

  if (!existsSync(filePath)) {
    return {
      file: { path: filePath, relativePath },
      content: '',
      selectors: [],
      rules: 0,
      lines: 0
    };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Basic parsing - count selectors and rules
    const selectorMatches = content.match(/[^{}]+(?=\{)/g) || [];
    const selectors = selectorMatches.map(s => s.trim()).filter(s => s.length > 0);

    return {
      file: { path: filePath, relativePath },
      content,
      selectors,
      rules: selectors.length,
      lines: lines.length,
      size: content.length
    };
  } catch (error) {
    return {
      file: { path: filePath, relativePath },
      content: '',
      selectors: [],
      rules: 0,
      lines: 0,
      error: error.message
    };
  }
}

export default { parseCSS };
