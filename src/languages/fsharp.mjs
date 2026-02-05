// src/languages/fsharp.mjs
// F# parser for open, module, type declarations

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
    const moduleMatch = content.match(/module\s+([\w.]+)/);
    const moduleName = moduleMatch ? moduleMatch[1] : null;
    if (moduleName) {
      exports.push({ name: moduleName, type: 'module', line: 1 });
    }

    // Namespace declaration
    const namespaceMatch = content.match(/namespace\s+([\w.]+)/);
    const namespaceName = namespaceMatch ? namespaceMatch[1] : null;

    // open statements (imports)
    const openPattern = /open\s+([\w.]+)/g;
    let match;
    while ((match = openPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'open',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Type definitions
    const typePattern = /type\s+(\w+)(?:\s*<[^>]+>)?\s*(?:=|\()/g;
    while ((match = typePattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'type', line: content.slice(0, match.index).split('\n').length });
    }

    // let bindings (top-level functions/values)
    const letPattern = /^let\s+(?:rec\s+)?(\w+)/gm;
    while ((match = letPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'let', line: content.slice(0, match.index).split('\n').length });
    }

    // Exception definitions
    const exceptionPattern = /exception\s+(\w+)/g;
    while ((match = exceptionPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'exception', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const hasEntryPoint = /\[<EntryPoint>\]/.test(content);
    const isTest = /open\s+(?:NUnit|Xunit|Expecto)|testCase|testList/.test(content);
    const isFable = /open\s+Fable\./.test(content);
    const isSaturn = /open\s+Saturn/.test(content);
    const isGiraffe = /open\s+Giraffe/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'fsharp-regex',
        moduleName,
        namespaceName,
        hasEntryPoint,
        isTest,
        isFable,
        isSaturn,
        isGiraffe
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
