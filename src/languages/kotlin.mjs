// src/languages/kotlin.mjs
// Kotlin parser for import, package, class declarations

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
    const importPattern = /import\s+([\w.]+)(?:\s+as\s+(\w+))?/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        alias: match[2] || null,
        type: 'import',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Class declarations
    const classPattern = /(?:public|private|protected|internal|open|abstract|sealed|data|enum|annotation|inline|value|\s)*\s*class\s+(\w+)(?:\s*<[^>]+>)?(?:\s*\([^)]*\))?(?:\s*:\s*[^{]+)?\s*\{?/g;
    while ((match = classPattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPublic = !prefix.includes('private') && !prefix.includes('internal');
      classes.push({
        name: match[1],
        public: isPublic,
        line: content.slice(0, match.index).split('\n').length
      });
      if (isPublic) {
        exports.push({ name: match[1], type: 'class', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Object declarations (singletons)
    const objectPattern = /(?:public|private|protected|internal|\s)*\s*object\s+(\w+)(?:\s*:\s*[^{]+)?\s*\{/g;
    while ((match = objectPattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPublic = !prefix.includes('private') && !prefix.includes('internal');
      if (isPublic) {
        exports.push({ name: match[1], type: 'object', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Interface declarations
    const interfacePattern = /(?:public|private|protected|internal|sealed|\s)*\s*interface\s+(\w+)(?:\s*<[^>]+>)?(?:\s*:\s*[^{]+)?\s*\{/g;
    while ((match = interfacePattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPublic = !prefix.includes('private') && !prefix.includes('internal');
      if (isPublic) {
        exports.push({ name: match[1], type: 'interface', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Top-level function declarations
    const funPattern = /^(?:public|private|protected|internal|inline|suspend|\s)*\s*fun\s+(?:<[^>]+>\s*)?(\w+)\s*\(/gm;
    while ((match = funPattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPublic = !prefix.includes('private') && !prefix.includes('internal');
      if (isPublic) {
        exports.push({ name: match[1], type: 'function', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Detect patterns
    const hasMainFunction = /fun\s+main\s*\(/.test(content);
    const isTest = /@Test|@ParameterizedTest|@BeforeEach|@AfterEach/.test(content);
    const isSpringComponent = /@(?:Component|Service|Repository|Controller|RestController|Configuration)/.test(content);

    return {
      imports,
      exports,
      classes,
      annotations: [],
      metadata: {
        parseMethod: 'kotlin-regex',
        packageName,
        hasMainFunction,
        isTest,
        isSpringComponent
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
