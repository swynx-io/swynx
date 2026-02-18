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

    // Strip comments before scanning (prevents false matches in doc strings)
    // Elixir has # line comments and @doc/@moduledoc heredocs
    const stripped = content
      .replace(/@(?:doc|moduledoc|typedoc)\s+~[sS]"""[\s\S]*?"""/g, '')  // sigil heredocs
      .replace(/@(?:doc|moduledoc|typedoc)\s+"""[\s\S]*?"""/g, '')       // heredoc strings
      .replace(/#[^\n]*/g, '');                                          // line comments

    // Module definition
    const modulePattern = /defmodule\s+([\w.]+)\s+do/g;
    let match;
    while ((match = modulePattern.exec(stripped)) !== null) {
      const line = stripped.slice(0, match.index).split('\n').length;
      modules.push({ name: match[1], line });
      exports.push({ name: match[1], type: 'module', line });
    }

    // Alias statements
    const aliasPattern = /alias\s+([\w.]+)(?:\s*,\s*as:\s*(\w+))?/g;
    while ((match = aliasPattern.exec(stripped)) !== null) {
      imports.push({
        module: match[1],
        alias: match[2] || null,
        type: 'alias',
        line: stripped.slice(0, match.index).split('\n').length
      });
    }

    // Import statements
    const importPattern = /import\s+([\w.]+)(?:\s*,\s*only:\s*\[[^\]]+\])?/g;
    while ((match = importPattern.exec(stripped)) !== null) {
      imports.push({
        module: match[1],
        type: 'import',
        line: stripped.slice(0, match.index).split('\n').length
      });
    }

    // Use statements (macros)
    const usePattern = /use\s+([\w.]+)(?:\s*,\s*[^\n]+)?/g;
    while ((match = usePattern.exec(stripped)) !== null) {
      imports.push({
        module: match[1],
        type: 'use',
        line: stripped.slice(0, match.index).split('\n').length
      });
    }

    // Require statements
    const requirePattern = /require\s+([\w.]+)/g;
    while ((match = requirePattern.exec(stripped)) !== null) {
      imports.push({
        module: match[1],
        type: 'require',
        line: stripped.slice(0, match.index).split('\n').length
      });
    }

    // Public function definitions
    const defPattern = /def\s+(\w+)(?:\(|,)/g;
    while ((match = defPattern.exec(stripped)) !== null) {
      exports.push({ name: match[1], type: 'function', line: stripped.slice(0, match.index).split('\n').length });
    }

    // Defmacro definitions
    const defmacroPattern = /defmacro\s+(\w+)(?:\(|,)/g;
    while ((match = defmacroPattern.exec(stripped)) !== null) {
      exports.push({ name: match[1], type: 'macro', line: stripped.slice(0, match.index).split('\n').length });
    }

    // Detect patterns (use stripped to avoid false positives from comments)
    const isGenServer = /use\s+GenServer/.test(stripped);
    const isSupervisor = /use\s+Supervisor/.test(stripped);
    const isPhoenix = /use\s+.*Web|use\s+Phoenix/.test(stripped);
    const isTest = /use\s+ExUnit\.Case|defmodule.*Test\s+do/.test(stripped);

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
