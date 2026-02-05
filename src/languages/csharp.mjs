// src/languages/csharp.mjs
// C# parser for using, namespace, class declarations

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
    const namespaces = [];

    // Using statements (imports)
    const usingPattern = /using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;/g;
    let match;
    while ((match = usingPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'using',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Using aliases
    const usingAliasPattern = /using\s+(\w+)\s*=\s*([A-Za-z_][\w.]*)\s*;/g;
    while ((match = usingAliasPattern.exec(content)) !== null) {
      imports.push({
        module: match[2],
        alias: match[1],
        type: 'using alias',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Global using (C# 10+)
    const globalUsingPattern = /global\s+using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;/g;
    while ((match = globalUsingPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'global using',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Namespace declarations
    const namespacePattern = /namespace\s+([A-Za-z_][\w.]*)\s*[{;]/g;
    while ((match = namespacePattern.exec(content)) !== null) {
      namespaces.push({
        name: match[1],
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Class declarations
    const classPattern = /(?:public|private|protected|internal|static|abstract|sealed|partial|\s)*\s*class\s+(\w+)(?:\s*<[^>]+>)?(?:\s*:\s*[\w\s,.<>]+)?\s*\{/g;
    while ((match = classPattern.exec(content)) !== null) {
      const isPublic = content.slice(Math.max(0, match.index - 50), match.index).includes('public');
      classes.push({
        name: match[1],
        public: isPublic,
        line: content.slice(0, match.index).split('\n').length
      });
      if (isPublic) {
        exports.push({ name: match[1], type: 'class', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Interface declarations
    const interfacePattern = /(?:public|private|protected|internal|\s)*\s*interface\s+(\w+)(?:\s*<[^>]+>)?(?:\s*:\s*[\w\s,.<>]+)?\s*\{/g;
    while ((match = interfacePattern.exec(content)) !== null) {
      const isPublic = content.slice(Math.max(0, match.index - 30), match.index).includes('public');
      if (isPublic) {
        exports.push({ name: match[1], type: 'interface', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Struct declarations
    const structPattern = /(?:public|private|protected|internal|readonly|\s)*\s*struct\s+(\w+)(?:\s*<[^>]+>)?\s*\{/g;
    while ((match = structPattern.exec(content)) !== null) {
      const isPublic = content.slice(Math.max(0, match.index - 30), match.index).includes('public');
      if (isPublic) {
        exports.push({ name: match[1], type: 'struct', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Enum declarations
    const enumPattern = /(?:public|private|protected|internal|\s)*\s*enum\s+(\w+)\s*\{/g;
    while ((match = enumPattern.exec(content)) !== null) {
      const isPublic = content.slice(Math.max(0, match.index - 30), match.index).includes('public');
      if (isPublic) {
        exports.push({ name: match[1], type: 'enum', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Detect patterns
    const hasMainMethod = /static\s+(?:async\s+)?(?:Task\s+|void\s+)?Main\s*\(/i.test(content);
    const isTest = /\[(?:Test|Fact|Theory|TestMethod)\]/.test(content);
    const hasTopLevelStatements = !content.includes('class ') && !content.includes('namespace ') &&
                                   /^(?!using)[a-zA-Z]/.test(content.replace(/using[^;]+;/g, '').trim());

    return {
      imports,
      exports,
      classes,
      namespaces,
      annotations: [],
      metadata: {
        parseMethod: 'csharp-regex',
        hasMainMethod,
        isTest,
        hasTopLevelStatements,
        namespace: namespaces[0]?.name || null
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
    namespaces: [],
    annotations: [],
    metadata: { parseMethod: 'none', error }
  };
}

export default { parse, initialize };
