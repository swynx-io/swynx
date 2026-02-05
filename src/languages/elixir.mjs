// src/languages/elixir.mjs
// Elixir parser for alias, import, use, require declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];
    const modules = [];

    // Module definition
    const modulePattern = /defmodule\s+([\w.]+)\s+do/g;
    let match;
    while ((match = modulePattern.exec(content)) !== null) {
      modules.push({
        name: match[1],
        line: content.slice(0, match.index).split('\n').length
      });
      exports.push({ name: match[1], type: 'module', line: content.slice(0, match.index).split('\n').length });
    }

    // Alias statements
    const aliasPattern = /alias\s+([\w.]+)(?:\s*,\s*as:\s*(\w+))?/g;
    while ((match = aliasPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        alias: match[2] || null,
        type: 'alias',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Import statements
    const importPattern = /import\s+([\w.]+)(?:\s*,\s*only:\s*\[[^\]]+\])?/g;
    while ((match = importPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'import',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Use statements (macros)
    const usePattern = /use\s+([\w.]+)(?:\s*,\s*[^\n]+)?/g;
    while ((match = usePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'use',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Require statements
    const requirePattern = /require\s+([\w.]+)/g;
    while ((match = requirePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'require',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Public function definitions
    const defPattern = /def\s+(\w+)(?:\(|,)/g;
    while ((match = defPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'function', line: content.slice(0, match.index).split('\n').length });
    }

    // Defmacro definitions
    const defmacroPattern = /defmacro\s+(\w+)(?:\(|,)/g;
    while ((match = defmacroPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'macro', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const isGenServer = /use\s+GenServer/.test(content);
    const isSupervisor = /use\s+Supervisor/.test(content);
    const isPhoenix = /use\s+.*Web|use\s+Phoenix/.test(content);
    const isTest = /use\s+ExUnit\.Case|defmodule.*Test\s+do/.test(content);

    return {
      imports,
      exports,
      modules,
      annotations: [],
      metadata: {
        parseMethod: 'elixir-regex',
        isGenServer,
        isSupervisor,
        isPhoenix,
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
    modules: [],
    annotations: [],
    metadata: { parseMethod: 'none', error }
  };
}

export default { parse, initialize };
