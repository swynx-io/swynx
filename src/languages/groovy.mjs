// src/languages/groovy.mjs
// Groovy parser for import, class, def declarations

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

    // Package declaration
    const packageMatch = content.match(/package\s+([\w.]+)/);
    const packageName = packageMatch ? packageMatch[1] : null;

    // Import statements
    const importPattern = /import\s+(?:static\s+)?([\w.]+)(?:\.\*)?/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: match[0].includes('static') ? 'static import' : 'import',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Class declarations
    const classPattern = /(?:public|private|protected|abstract|final|\s)*\s*class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/g;
    while ((match = classPattern.exec(content)) !== null) {
      classes.push({
        name: match[1],
        line: content.slice(0, match.index).split('\n').length
      });
      exports.push({ name: match[1], type: 'class', line: content.slice(0, match.index).split('\n').length });
    }

    // Interface declarations
    const interfacePattern = /interface\s+(\w+)/g;
    while ((match = interfacePattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'interface', line: content.slice(0, match.index).split('\n').length });
    }

    // Trait declarations (Groovy-specific)
    const traitPattern = /trait\s+(\w+)/g;
    while ((match = traitPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'trait', line: content.slice(0, match.index).split('\n').length });
    }

    // Enum declarations
    const enumPattern = /enum\s+(\w+)/g;
    while ((match = enumPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'enum', line: content.slice(0, match.index).split('\n').length });
    }

    // Method definitions (def or typed)
    const defPattern = /(?:def|void|[\w<>\[\]]+)\s+(\w+)\s*\([^)]*\)\s*\{/g;
    while ((match = defPattern.exec(content)) !== null) {
      const name = match[1];
      if (!['if', 'while', 'for', 'switch', 'catch', 'try'].includes(name)) {
        exports.push({ name, type: 'method', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Detect patterns
    const isSpock = /import\s+spock\.|extends\s+Specification/.test(content);
    const isGradle = filePath.endsWith('.gradle');
    const isJenkinsfile = filePath.includes('Jenkinsfile');
    const isGrails = /import\s+grails\./.test(content);

    return {
      imports,
      exports,
      classes,
      annotations: [],
      metadata: {
        parseMethod: 'groovy-regex',
        packageName,
        isSpock,
        isGradle,
        isJenkinsfile,
        isGrails
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
