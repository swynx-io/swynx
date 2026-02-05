// src/languages/haskell.mjs
// Haskell parser for import, module declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // Module declaration with exports
    const modulePattern = /module\s+([\w.]+)\s*(?:\(\s*([^)]*)\s*\))?\s*where/;
    const moduleMatch = content.match(modulePattern);
    const moduleName = moduleMatch ? moduleMatch[1] : null;
    if (moduleMatch && moduleMatch[2]) {
      // Parse explicit exports
      const exportList = moduleMatch[2].split(',').map(e => e.trim()).filter(e => e);
      for (const exp of exportList) {
        if (exp && !exp.startsWith('module')) {
          exports.push({ name: exp.replace(/\(.*\)/, '').trim(), type: 'export', line: 1 });
        }
      }
    }

    // Import statements
    const importPattern = /import\s+(?:qualified\s+)?([\w.]+)(?:\s+as\s+(\w+))?(?:\s+hiding\s*\([^)]*\))?(?:\s*\([^)]*\))?/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        alias: match[2] || null,
        type: 'import',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Type declarations
    const typePattern = /^(data|newtype|type)\s+(\w+)/gm;
    while ((match = typePattern.exec(content)) !== null) {
      exports.push({ name: match[2], type: match[1], line: content.slice(0, match.index).split('\n').length });
    }

    // Class declarations
    const classPattern = /^class\s+(?:[^=>]+=>)?\s*(\w+)/gm;
    while ((match = classPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'class', line: content.slice(0, match.index).split('\n').length });
    }

    // Top-level function declarations (with type signature)
    const funPattern = /^(\w+)\s*::\s*[^\n]+\n\1\s+/gm;
    while ((match = funPattern.exec(content)) !== null) {
      if (!['import', 'module', 'data', 'type', 'newtype', 'class', 'instance', 'where'].includes(match[1])) {
        exports.push({ name: match[1], type: 'function', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Detect patterns
    const hasMain = /^main\s*::|^main\s*=/m.test(content);
    const isTest = /import\s+Test\.|Spec\s*where|describe\s*"/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'haskell-regex',
        moduleName,
        hasMain,
        isTest
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
    annotations: [],
    metadata: { parseMethod: 'none', error }
  };
}

export default { parse, initialize };
