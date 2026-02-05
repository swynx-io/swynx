// src/languages/v.mjs
// V language parser for import, module, fn, struct declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // Module declaration
    const moduleMatch = content.match(/module\s+(\w+)/);
    const moduleName = moduleMatch ? moduleMatch[1] : null;
    if (moduleName) {
      exports.push({ name: moduleName, type: 'module', line: 1 });
    }

    // Import statements
    const importPattern = /import\s+([\w.]+)(?:\s+as\s+(\w+))?/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        alias: match[2] || null,
        type: 'import',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Function definitions (pub fn)
    const pubFnPattern = /pub\s+fn\s+(\w+)/g;
    while ((match = pubFnPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'function', public: true, line: content.slice(0, match.index).split('\n').length });
    }

    // Private function definitions
    const fnPattern = /(?<!pub\s)fn\s+(\w+)/g;
    while ((match = fnPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'function', public: false, line: content.slice(0, match.index).split('\n').length });
    }

    // Struct definitions
    const structPattern = /(?:pub\s+)?struct\s+(\w+)/g;
    while ((match = structPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'struct', line: content.slice(0, match.index).split('\n').length });
    }

    // Enum definitions
    const enumPattern = /(?:pub\s+)?enum\s+(\w+)/g;
    while ((match = enumPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'enum', line: content.slice(0, match.index).split('\n').length });
    }

    // Interface definitions
    const interfacePattern = /(?:pub\s+)?interface\s+(\w+)/g;
    while ((match = interfacePattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'interface', line: content.slice(0, match.index).split('\n').length });
    }

    // Type alias definitions
    const typePattern = /(?:pub\s+)?type\s+(\w+)\s*=/g;
    while ((match = typePattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'type', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const hasMain = /fn\s+main\s*\(\s*\)/.test(content);
    const isTest = /fn\s+test_|import\s+testing/.test(content);
    const isVweb = /import\s+vweb/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'v-regex',
        moduleName,
        hasMain,
        isTest,
        isVweb
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
