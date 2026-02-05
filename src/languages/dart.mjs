// src/languages/dart.mjs
// Dart parser for import, export, part declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];
    const classes = [];

    // Library declaration
    const libraryMatch = content.match(/library\s+([\w.]+)\s*;/);
    const libraryName = libraryMatch ? libraryMatch[1] : null;

    // Import statements
    const importPattern = /import\s+['"]([^'"]+)['"]\s*(?:as\s+(\w+))?(?:\s+(?:show|hide)\s+[^;]+)?(?:\s+deferred)?(?:\s+if\s*\([^)]+\))?\s*;/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        alias: match[2] || null,
        type: 'import',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Export statements (re-exports)
    const exportPattern = /export\s+['"]([^'"]+)['"]\s*(?:show|hide\s+[^;]+)?\s*;/g;
    while ((match = exportPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'export',
        sourceModule: match[1],
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Part declarations (file is part of another library)
    const partOfPattern = /part\s+of\s+['"]?([^'";]+)['"]?\s*;/g;
    while ((match = partOfPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'part of',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Part includes (library includes other files)
    const partPattern = /part\s+['"]([^'"]+)['"]\s*;/g;
    while ((match = partPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'part',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Class declarations
    const classPattern = /(?:abstract\s+|sealed\s+|base\s+|interface\s+|final\s+|mixin\s+)*class\s+(\w+)(?:\s*<[^>]+>)?(?:\s+extends\s+\w+)?(?:\s+with\s+[\w\s,]+)?(?:\s+implements\s+[\w\s,<>]+)?\s*\{/g;
    while ((match = classPattern.exec(content)) !== null) {
      const name = match[1];
      const isPrivate = name.startsWith('_');
      classes.push({
        name,
        public: !isPrivate,
        line: content.slice(0, match.index).split('\n').length
      });
      if (!isPrivate) {
        exports.push({ name, type: 'class', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Mixin declarations
    const mixinPattern = /mixin\s+(\w+)(?:\s+on\s+[\w\s,]+)?\s*\{/g;
    while ((match = mixinPattern.exec(content)) !== null) {
      const name = match[1];
      const isPrivate = name.startsWith('_');
      if (!isPrivate) {
        exports.push({ name, type: 'mixin', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Extension declarations
    const extensionPattern = /extension\s+(\w+)\s+on\s+/g;
    while ((match = extensionPattern.exec(content)) !== null) {
      const name = match[1];
      const isPrivate = name.startsWith('_');
      if (!isPrivate) {
        exports.push({ name, type: 'extension', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Enum declarations
    const enumPattern = /enum\s+(\w+)\s*\{/g;
    while ((match = enumPattern.exec(content)) !== null) {
      const name = match[1];
      const isPrivate = name.startsWith('_');
      if (!isPrivate) {
        exports.push({ name, type: 'enum', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Typedef declarations
    const typedefPattern = /typedef\s+(\w+)\s*[=<]/g;
    while ((match = typedefPattern.exec(content)) !== null) {
      const name = match[1];
      const isPrivate = name.startsWith('_');
      if (!isPrivate) {
        exports.push({ name, type: 'typedef', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Top-level function declarations
    const funPattern = /^(?:\w+\s+)*(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)\s*(?:async\s*)?(?:\{|=>|;)/gm;
    while ((match = funPattern.exec(content)) !== null) {
      const name = match[1];
      if (!['if', 'for', 'while', 'switch', 'catch', 'class', 'return'].includes(name) && !name.startsWith('_')) {
        // Check if it's actually a top-level function (not inside a class)
        const before = content.slice(0, match.index);
        const openBraces = (before.match(/\{/g) || []).length;
        const closeBraces = (before.match(/\}/g) || []).length;
        if (openBraces === closeBraces) {
          exports.push({ name, type: 'function', line: content.slice(0, match.index).split('\n').length });
        }
      }
    }

    // Detect patterns
    const hasMainFunction = /void\s+main\s*\(/.test(content);
    const isTest = /@isTest|import\s+['"]package:test\//.test(content);
    const isFlutter = /import\s+['"]package:flutter\//.test(content);

    return {
      imports,
      exports,
      classes,
      annotations: [],
      metadata: {
        parseMethod: 'dart-regex',
        libraryName,
        hasMainFunction,
        isTest,
        isFlutter
      }
    };
  } catch (error) {
    return createEmptyResult(filePath, `Parse error: ${error.message}`);
  }
}

function createEmptyResult(filePath, error = null) {
  return {
    imports: [],
    exports: [],
    classes: [],
    annotations: [],
    metadata: { parseMethod: 'none', error }
  };
}

export default { parse, initialize };
