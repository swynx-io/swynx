// src/languages/lua.mjs
// Lua parser for require, module declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // Require statements
    const requirePattern = /(?:local\s+\w+\s*=\s*)?require\s*[\("']([^"')]+)["')]/g;
    let match;
    while ((match = requirePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'require',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // dofile/loadfile statements
    const dofilePattern = /(?:dofile|loadfile)\s*[\("']([^"')]+)["')]/g;
    while ((match = dofilePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'dofile',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Module return pattern (common Lua module pattern)
    // local M = {} ... return M
    const modulePattern = /local\s+(\w+)\s*=\s*\{\s*\}[\s\S]*return\s+\1\s*$/;
    const hasModulePattern = modulePattern.test(content);

    // Function definitions that are exported (M.func = function or function M.func)
    const exportedFuncPattern = /(\w+)\.(\w+)\s*=\s*function|function\s+(\w+)\.(\w+)/g;
    while ((match = exportedFuncPattern.exec(content)) !== null) {
      const funcName = match[2] || match[4];
      exports.push({ name: funcName, type: 'function', line: content.slice(0, match.index).split('\n').length });
    }

    // Global function definitions
    const globalFuncPattern = /^function\s+(\w+)\s*\(/gm;
    while ((match = globalFuncPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'function', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const isLove2D = /require\s*["']love/.test(content) || /love\./.test(content);
    const isCorona = /require\s*["']composer|display\.newRect/.test(content);
    const isDefold = /require\s*["']defold/.test(content);
    const isTest = /require\s*["'](?:busted|luaunit)|describe\s*\(/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'lua-regex',
        hasModulePattern,
        isLove2D,
        isCorona,
        isDefold,
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
