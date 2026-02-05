// src/languages/objc.mjs
// Objective-C parser for #import, @interface, @implementation declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // #import statements
    const importPattern = /#import\s*[<"]([^>"]+)[>"]/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      const isSystem = content[match.index + 8] === '<';
      imports.push({
        module: match[1],
        type: isSystem ? 'system import' : 'local import',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // #include statements (also valid in Obj-C)
    const includePattern = /#include\s*[<"]([^>"]+)[>"]/g;
    while ((match = includePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'include',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // @import statements (modern modules)
    const moduleImportPattern = /@import\s+([\w.]+)\s*;/g;
    while ((match = moduleImportPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'module import',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // @interface declarations
    const interfacePattern = /@interface\s+(\w+)\s*(?::\s*(\w+))?/g;
    while ((match = interfacePattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        superclass: match[2] || null,
        type: 'interface',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // @implementation declarations
    const implementationPattern = /@implementation\s+(\w+)/g;
    while ((match = implementationPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'implementation',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // @protocol declarations
    const protocolPattern = /@protocol\s+(\w+)/g;
    while ((match = protocolPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'protocol',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Method declarations (-/+ methods)
    const methodPattern = /^[+-]\s*\([^)]+\)\s*(\w+)/gm;
    while ((match = methodPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'method',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Detect patterns
    const isHeader = /\.h$/.test(filePath);
    const isUIKit = /#import\s*<UIKit\/UIKit\.h>|@import\s+UIKit/.test(content);
    const isFoundation = /#import\s*<Foundation\/Foundation\.h>|@import\s+Foundation/.test(content);
    const isTest = /#import\s*<XCTest\/XCTest\.h>|@import\s+XCTest/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'objc-regex',
        isHeader,
        isUIKit,
        isFoundation,
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
