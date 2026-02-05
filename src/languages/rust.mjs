// src/languages/rust.mjs
// Rust parser for mod, use, pub declarations

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
    const functions = [];
    const structs = [];
    const enums = [];
    const traits = [];

    // Use statements (imports)
    const usePattern = /use\s+([\w:]+(?:::\{[^}]+\}|::\*)?)\s*;/g;
    let match;
    while ((match = usePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'use',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Extern crate
    const externPattern = /extern\s+crate\s+(\w+)(?:\s+as\s+(\w+))?\s*;/g;
    while ((match = externPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        alias: match[2] || null,
        type: 'extern crate',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Module declarations (mod)
    // Only `mod foo;` (external modules) need to be followed, not inline `mod foo { ... }`
    const modPattern = /(?:pub\s+)?mod\s+(\w+)\s*(;|\{)/g;
    while ((match = modPattern.exec(content)) !== null) {
      const isPublic = content.slice(Math.max(0, match.index - 5), match.index).includes('pub');
      const isExternalMod = match[2] === ';'; // `mod foo;` vs `mod foo { }`
      const line = content.slice(0, match.index).split('\n').length;
      modules.push({
        name: match[1],
        type: 'mod',
        public: isPublic,
        external: isExternalMod,
        line
      });
      if (isPublic) {
        exports.push({ name: match[1], type: 'mod', line });
      }
      // Add external mod declarations to imports so graph.mjs can follow them
      if (isExternalMod) {
        imports.push({
          module: match[1],
          type: 'mod',
          line
        });
      }
    }

    // Function declarations
    const fnPattern = /(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+(\w+)/g;
    while ((match = fnPattern.exec(content)) !== null) {
      const isPublic = content.slice(Math.max(0, match.index - 10), match.index).includes('pub');
      const funcName = match[1];
      const line = content.slice(0, match.index).split('\n').length;
      functions.push({
        name: funcName,
        type: 'fn',
        public: isPublic,
        line
      });
      if (isPublic) {
        exports.push({ name: funcName, type: 'function', line });
      }
    }

    // Struct declarations
    const structPattern = /(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)/g;
    while ((match = structPattern.exec(content)) !== null) {
      const isPublic = content.slice(Math.max(0, match.index - 10), match.index).includes('pub');
      const line = content.slice(0, match.index).split('\n').length;
      structs.push({
        name: match[1],
        public: isPublic,
        line
      });
      if (isPublic) {
        exports.push({ name: match[1], type: 'struct', line });
      }
    }

    // Enum declarations
    const enumPattern = /(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)/g;
    while ((match = enumPattern.exec(content)) !== null) {
      const isPublic = content.slice(Math.max(0, match.index - 10), match.index).includes('pub');
      const line = content.slice(0, match.index).split('\n').length;
      enums.push({
        name: match[1],
        public: isPublic,
        line
      });
      if (isPublic) {
        exports.push({ name: match[1], type: 'enum', line });
      }
    }

    // Trait declarations
    const traitPattern = /(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)/g;
    while ((match = traitPattern.exec(content)) !== null) {
      const isPublic = content.slice(Math.max(0, match.index - 10), match.index).includes('pub');
      const line = content.slice(0, match.index).split('\n').length;
      traits.push({
        name: match[1],
        public: isPublic,
        line
      });
      if (isPublic) {
        exports.push({ name: match[1], type: 'trait', line });
      }
    }

    // Impl blocks
    const implPattern = /impl(?:<[^>]*>)?\s+(?:(\w+)\s+for\s+)?(\w+)/g;
    while ((match = implPattern.exec(content)) !== null) {
      // Don't add impl blocks as exports, but track them for understanding code structure
    }

    // Detect patterns
    const isMain = functions.some(f => f.name === 'main');
    const isLib = filePath.endsWith('lib.rs');
    const isBin = filePath.endsWith('main.rs') || filePath.includes('/bin/');
    const isTest = content.includes('#[test]') || content.includes('#[cfg(test)]');
    const isBench = content.includes('#[bench]');

    // Macro exports
    const macroPattern = /#\[macro_export\]\s*macro_rules!\s+(\w+)/g;
    while ((match = macroPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'macro',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    return {
      imports,
      exports,
      modules,
      functions,
      structs,
      enums,
      traits,
      annotations: [],
      metadata: {
        parseMethod: 'rust-regex',
        isMain,
        isLib,
        isBin,
        isTest,
        isBench,
        hasMainFunction: isMain
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
    functions: [],
    structs: [],
    enums: [],
    traits: [],
    annotations: [],
    metadata: { parseMethod: 'none', error }
  };
}

export default { parse, initialize };
