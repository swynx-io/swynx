// src/scanner/parsers/generic-lang.mjs
// Generic scanner parser that wraps any src/languages/*.mjs handler.
// Used for Tier 2 languages that have regex parsers but don't need
// specialised scanner-level logic (like Rust's mod resolution or Go's packages).

import { readFileSync, existsSync } from 'fs';

/**
 * Create a scanner parser for a given language handler module.
 * @param {Function} langParseFn - The parse(filePath, content) function from src/languages/*.mjs
 * @param {string} parseMethodLabel - Label for the parseMethod field (e.g., 'php-regex')
 * @returns {{ parse: Function }}
 */
export function createLangParser(langParseFn, parseMethodLabel) {
  async function parse(file) {
    const filePath = typeof file === 'string' ? file : file.path;
    const relativePath = typeof file === 'string' ? file : file.relativePath;

    if (!existsSync(filePath)) {
      return createEmptyResult(filePath, relativePath, 'File not found');
    }

    let content;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (error) {
      return createEmptyResult(filePath, relativePath, `Read error: ${error.message}`);
    }

    try {
      const result = langParseFn(filePath, content);
      const lines = content.split('\n');

      return {
        file: { path: filePath, relativePath },
        content,
        functions: result.functions || [],
        classes: result.classes || [],
        exports: result.exports || [],
        imports: result.imports || [],
        annotations: result.annotations || [],
        lines: lines.length,
        size: content.length,
        parseMethod: result.metadata?.parseMethod || parseMethodLabel,
        metadata: result.metadata || {}
      };
    } catch (error) {
      return createEmptyResult(filePath, relativePath, `Parse error: ${error.message}`);
    }
  }

  return { parse };
}

function createEmptyResult(filePath, relativePath, error) {
  return {
    file: { path: filePath, relativePath },
    content: '',
    functions: [],
    classes: [],
    exports: [],
    imports: [],
    annotations: [],
    lines: 0,
    size: 0,
    error,
    parseMethod: 'none'
  };
}
