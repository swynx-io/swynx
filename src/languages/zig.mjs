// src/languages/zig.mjs
// Zig parser for @import, pub declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // @import statements
    const importPattern = /@import\s*\(\s*"([^"]+)"\s*\)/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'import',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // @embedFile statements
    const embedPattern = /@embedFile\s*\(\s*"([^"]+)"\s*\)/g;
    while ((match = embedPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'embedFile',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // pub fn definitions
    const pubFnPattern = /pub\s+fn\s+(\w+)/g;
    while ((match = pubFnPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'function', line: content.slice(0, match.index).split('\n').length });
    }

    // pub const definitions
    const pubConstPattern = /pub\s+const\s+(\w+)/g;
    while ((match = pubConstPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'const', line: content.slice(0, match.index).split('\n').length });
    }

    // pub var definitions
    const pubVarPattern = /pub\s+var\s+(\w+)/g;
    while ((match = pubVarPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'var', line: content.slice(0, match.index).split('\n').length });
    }

    // Struct definitions (pub const Foo = struct)
    const structPattern = /(?:pub\s+)?const\s+(\w+)\s*=\s*(?:packed\s+)?struct/g;
    while ((match = structPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'struct', line: content.slice(0, match.index).split('\n').length });
    }

    // Union definitions
    const unionPattern = /(?:pub\s+)?const\s+(\w+)\s*=\s*(?:packed\s+)?union/g;
    while ((match = unionPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'union', line: content.slice(0, match.index).split('\n').length });
    }

    // Enum definitions
    const enumPattern = /(?:pub\s+)?const\s+(\w+)\s*=\s*enum/g;
    while ((match = enumPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'enum', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const hasMain = /pub\s+fn\s+main\s*\(/.test(content);
    const isTest = /test\s+"[^"]+"\s*\{/.test(content);
    const isStd = /@import\s*\(\s*"std"\s*\)/.test(content);
    const isBuildZig = filePath.endsWith('build.zig');

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'zig-regex',
        hasMain,
        isTest,
        isStd,
        isBuildZig
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
