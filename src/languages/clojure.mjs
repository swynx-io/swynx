// src/languages/clojure.mjs
// Clojure parser for ns, require, import, use declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // Namespace declaration
    const nsMatch = content.match(/\(ns\s+([\w.-]+)/);
    const namespaceName = nsMatch ? nsMatch[1] : null;
    if (namespaceName) {
      exports.push({ name: namespaceName, type: 'namespace', line: 1 });
    }

    // :require declarations within ns
    const requirePattern = /\(:require\s+([^)]+)\)/gs;
    let match;
    while ((match = requirePattern.exec(content)) !== null) {
      const requireBlock = match[1];
      // Parse individual requires: [ns.name :as alias] or ns.name
      const nsPattern = /\[?([\w.-]+)(?:\s+:as\s+(\w+))?/g;
      let nsMatch;
      while ((nsMatch = nsPattern.exec(requireBlock)) !== null) {
        if (nsMatch[1] && !nsMatch[1].startsWith(':')) {
          imports.push({
            module: nsMatch[1],
            alias: nsMatch[2] || null,
            type: 'require',
            line: content.slice(0, match.index).split('\n').length
          });
        }
      }
    }

    // :import declarations (Java interop)
    const importPattern = /\(:import\s+([^)]+)\)/gs;
    while ((match = importPattern.exec(content)) !== null) {
      const importBlock = match[1];
      // Parse: (java.package Class1 Class2) or java.package.Class
      const classPattern = /\(?([\w.]+)(?:\s+([\w\s]+))?\)?/g;
      let classMatch;
      while ((classMatch = classPattern.exec(importBlock)) !== null) {
        imports.push({
          module: classMatch[1],
          type: 'import',
          line: content.slice(0, match.index).split('\n').length
        });
      }
    }

    // :use declarations (deprecated but still used)
    const usePattern = /\(:use\s+([^)]+)\)/gs;
    while ((match = usePattern.exec(content)) !== null) {
      const useBlock = match[1];
      const nsPattern = /\[?([\w.-]+)/g;
      let nsMatch;
      while ((nsMatch = nsPattern.exec(useBlock)) !== null) {
        if (nsMatch[1] && !nsMatch[1].startsWith(':')) {
          imports.push({
            module: nsMatch[1],
            type: 'use',
            line: content.slice(0, match.index).split('\n').length
          });
        }
      }
    }

    // defn - function definitions
    const defnPattern = /\(defn-?\s+(\^?\w+)/g;
    while ((match = defnPattern.exec(content)) !== null) {
      const name = match[1].replace(/^\^/, '');
      exports.push({ name, type: 'function', line: content.slice(0, match.index).split('\n').length });
    }

    // defmacro - macro definitions
    const defmacroPattern = /\(defmacro\s+(\w+)/g;
    while ((match = defmacroPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'macro', line: content.slice(0, match.index).split('\n').length });
    }

    // defrecord, deftype, defprotocol
    const defTypePattern = /\(def(?:record|type|protocol)\s+(\w+)/g;
    while ((match = defTypePattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'type', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const isTest = /\(clojure\.test\/|deftest\s+/.test(content);
    const isRing = /ring\./.test(content);
    const isCompojure = /compojure\./.test(content);
    const isReFrame = /re-frame\./.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'clojure-regex',
        namespaceName,
        isTest,
        isRing,
        isCompojure,
        isReFrame
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
