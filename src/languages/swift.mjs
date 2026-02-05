// src/languages/swift.mjs
// Swift parser for import, class, struct, protocol declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];
    const classes = [];

    // Import statements
    const importPattern = /import\s+(?:(?:typealias|struct|class|enum|protocol|let|var|func)\s+)?(\w+(?:\.\w+)*)/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'import',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // @_exported import (re-exports)
    const exportedImportPattern = /@_exported\s+import\s+(\w+(?:\.\w+)*)/g;
    while ((match = exportedImportPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'exported import',
        line: content.slice(0, match.index).split('\n').length
      });
      exports.push({
        name: match[1],
        type: 'reexport',
        sourceModule: match[1],
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Class declarations
    const classPattern = /(?:public|private|fileprivate|internal|open|final|\s)*\s*class\s+(\w+)(?:\s*<[^>]+>)?(?:\s*:\s*[^{]+)?\s*\{/g;
    while ((match = classPattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPublic = prefix.includes('public') || prefix.includes('open');
      const isPrivate = prefix.includes('private') || prefix.includes('fileprivate');
      classes.push({
        name: match[1],
        public: isPublic,
        line: content.slice(0, match.index).split('\n').length
      });
      if (isPublic || (!isPrivate && !prefix.includes('internal'))) {
        exports.push({ name: match[1], type: 'class', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Struct declarations
    const structPattern = /(?:public|private|fileprivate|internal|\s)*\s*struct\s+(\w+)(?:\s*<[^>]+>)?(?:\s*:\s*[^{]+)?\s*\{/g;
    while ((match = structPattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPublic = prefix.includes('public');
      const isPrivate = prefix.includes('private') || prefix.includes('fileprivate');
      if (isPublic || (!isPrivate && !prefix.includes('internal'))) {
        exports.push({ name: match[1], type: 'struct', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Enum declarations
    const enumPattern = /(?:public|private|fileprivate|internal|\s)*\s*enum\s+(\w+)(?:\s*<[^>]+>)?(?:\s*:\s*[^{]+)?\s*\{/g;
    while ((match = enumPattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPublic = prefix.includes('public');
      const isPrivate = prefix.includes('private') || prefix.includes('fileprivate');
      if (isPublic || (!isPrivate && !prefix.includes('internal'))) {
        exports.push({ name: match[1], type: 'enum', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Protocol declarations
    const protocolPattern = /(?:public|private|fileprivate|internal|\s)*\s*protocol\s+(\w+)(?:\s*:\s*[^{]+)?\s*\{/g;
    while ((match = protocolPattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPublic = prefix.includes('public');
      const isPrivate = prefix.includes('private') || prefix.includes('fileprivate');
      if (isPublic || (!isPrivate && !prefix.includes('internal'))) {
        exports.push({ name: match[1], type: 'protocol', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Actor declarations (Swift 5.5+)
    const actorPattern = /(?:public|private|fileprivate|internal|\s)*\s*actor\s+(\w+)(?:\s*<[^>]+>)?(?:\s*:\s*[^{]+)?\s*\{/g;
    while ((match = actorPattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPublic = prefix.includes('public');
      const isPrivate = prefix.includes('private') || prefix.includes('fileprivate');
      if (isPublic || (!isPrivate && !prefix.includes('internal'))) {
        exports.push({ name: match[1], type: 'actor', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Extension declarations
    const extensionPattern = /extension\s+(\w+)(?:\s*:\s*[^{]+)?\s*\{/g;
    while ((match = extensionPattern.exec(content)) !== null) {
      // Extensions extend existing types, track for reference
    }

    // Detect patterns
    const hasMainAnnotation = /@main|@UIApplicationMain|@NSApplicationMain/.test(content);
    const isTest = /import\s+XCTest|@testable/.test(content);
    const isSwiftUI = /import\s+SwiftUI/.test(content);
    const isUIKit = /import\s+UIKit/.test(content);

    return {
      imports,
      exports,
      classes,
      annotations: [],
      metadata: {
        parseMethod: 'swift-regex',
        hasMainAnnotation,
        isTest,
        isSwiftUI,
        isUIKit
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
    classes: [],
    annotations: [],
    metadata: { parseMethod: 'none', error }
  };
}

export default { parse, initialize };
