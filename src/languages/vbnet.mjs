// src/languages/vbnet.mjs
// VB.NET parser for Imports, Class, Module, Sub, Function declarations

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
    const namespaceMatch = content.match(/Namespace\s+([\w.]+)/i);
    const namespaceName = namespaceMatch ? namespaceMatch[1] : null;

    // Imports statements
    const importsPattern = /^Imports\s+([\w.]+)/gim;
    let match;
    while ((match = importsPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'Imports',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Class declarations
    const classPattern = /(?:Public|Private|Protected|Friend|MustInherit|NotInheritable|\s)*\s*Class\s+(\w+)/gi;
    while ((match = classPattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPublic = /Public/i.test(prefix) || !/Private|Friend/i.test(prefix);
      if (isPublic) {
        exports.push({
          name: match[1],
          type: 'class',
          line: content.slice(0, match.index).split('\n').length
        });
      }
    }

    // Module declarations
    const modulePattern = /(?:Public|Private|Friend|\s)*\s*Module\s+(\w+)/gi;
    while ((match = modulePattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'module',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Interface declarations
    const interfacePattern = /(?:Public|Private|Protected|Friend|\s)*\s*Interface\s+(\w+)/gi;
    while ((match = interfacePattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'interface',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Structure declarations
    const structurePattern = /(?:Public|Private|Protected|Friend|\s)*\s*Structure\s+(\w+)/gi;
    while ((match = structurePattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'structure',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Enum declarations
    const enumPattern = /(?:Public|Private|Protected|Friend|\s)*\s*Enum\s+(\w+)/gi;
    while ((match = enumPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'enum',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Sub declarations
    const subPattern = /(?:Public|Private|Protected|Friend|Shared|Overrides|Overridable|MustOverride|\s)*\s*Sub\s+(\w+)/gi;
    while ((match = subPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'sub',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Function declarations
    const funcPattern = /(?:Public|Private|Protected|Friend|Shared|Overrides|Overridable|MustOverride|\s)*\s*Function\s+(\w+)/gi;
    while ((match = funcPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'function',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Detect patterns
    const isWinForms = /Imports\s+System\.Windows\.Forms/i.test(content);
    const isWPF = /Imports\s+System\.Windows/i.test(content);
    const isASPNET = /Imports\s+System\.Web/i.test(content);
    const isTest = /Imports\s+(?:Microsoft\.VisualStudio\.TestTools|NUnit|xUnit)/i.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'vbnet-regex',
        namespaceName,
        isWinForms,
        isWPF,
        isASPNET,
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
