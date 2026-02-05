// src/languages/ocaml.mjs
// OCaml parser for open, module, type declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // open statements
    const openPattern = /open\s+([\w.]+)/g;
    let match;
    while ((match = openPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'open',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Module definitions
    const modulePattern = /module\s+(\w+)\s*(?::\s*[\w.]+\s*)?=/g;
    while ((match = modulePattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'module', line: content.slice(0, match.index).split('\n').length });
    }

    // Module type definitions
    const modTypePattern = /module\s+type\s+(\w+)/g;
    while ((match = modTypePattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'module type', line: content.slice(0, match.index).split('\n').length });
    }

    // Type definitions
    const typePattern = /type\s+(?:'?\w+\s+)*(\w+)/g;
    while ((match = typePattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'type', line: content.slice(0, match.index).split('\n').length });
    }

    // let bindings (top-level)
    const letPattern = /^let\s+(?:rec\s+)?(\w+)/gm;
    while ((match = letPattern.exec(content)) !== null) {
      const name = match[1];
      if (!['_', 'open', 'module', 'type'].includes(name)) {
        exports.push({ name, type: 'let', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Exception definitions
    const exceptionPattern = /exception\s+(\w+)/g;
    while ((match = exceptionPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'exception', line: content.slice(0, match.index).split('\n').length });
    }

    // External declarations
    const externalPattern = /external\s+(\w+)/g;
    while ((match = externalPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'external', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const isInterface = filePath.endsWith('.mli');
    const isTest = /open\s+(?:OUnit|Alcotest)|let\s+tests?\s*=/.test(content);
    const isDune = filePath.includes('dune');
    const isLwt = /open\s+Lwt|Lwt\./.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'ocaml-regex',
        isInterface,
        isTest,
        isDune,
        isLwt
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
