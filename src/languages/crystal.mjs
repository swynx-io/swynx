// src/languages/crystal.mjs
// Crystal parser for require, class, module, def declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // require statements
    const requirePattern = /require\s+["']([^"']+)["']/g;
    let match;
    while ((match = requirePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'require',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Module definitions
    const modulePattern = /module\s+(\w+)/g;
    while ((match = modulePattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'module', line: content.slice(0, match.index).split('\n').length });
    }

    // Class definitions
    const classPattern = /(?:abstract\s+)?class\s+(\w+)(?:\s*<\s*\w+)?/g;
    while ((match = classPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'class', line: content.slice(0, match.index).split('\n').length });
    }

    // Struct definitions
    const structPattern = /(?:abstract\s+)?struct\s+(\w+)/g;
    while ((match = structPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'struct', line: content.slice(0, match.index).split('\n').length });
    }

    // Enum definitions
    const enumPattern = /enum\s+(\w+)/g;
    while ((match = enumPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'enum', line: content.slice(0, match.index).split('\n').length });
    }

    // Annotation definitions
    const annotationPattern = /annotation\s+(\w+)/g;
    while ((match = annotationPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'annotation', line: content.slice(0, match.index).split('\n').length });
    }

    // Method definitions
    const defPattern = /def\s+(self\.)?(\w+[?!]?)/g;
    while ((match = defPattern.exec(content)) !== null) {
      exports.push({
        name: match[2],
        type: match[1] ? 'class method' : 'method',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Macro definitions
    const macroPattern = /macro\s+(\w+)/g;
    while ((match = macroPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'macro', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const isSpec = /require\s+["']spec["']|describe\s+/.test(content) || filePath.includes('_spec.cr');
    const isAmber = /require\s+["']amber["']/.test(content);
    const isKemal = /require\s+["']kemal["']/.test(content);
    const isLucky = /require\s+["']lucky["']/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'crystal-regex',
        isSpec,
        isAmber,
        isKemal,
        isLucky
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
