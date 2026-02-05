// src/languages/scala.mjs
// Scala parser for import, package, class, object, trait declarations

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

    // Import statements (Scala supports multiple imports in braces)
    const importPattern = /import\s+([\w.]+)(?:\.{([^}]+)}|\.(\w+|\*))?/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      const basePath = match[1];
      if (match[2]) {
        // Multiple imports: import foo.{A, B, C}
        const members = match[2].split(',').map(m => m.trim().split('=>')[0].trim());
        for (const member of members) {
          if (member && member !== '_') {
            imports.push({
              module: `${basePath}.${member}`,
              type: 'import',
              line: content.slice(0, match.index).split('\n').length
            });
          }
        }
      } else if (match[3]) {
        // Single import or wildcard
        imports.push({
          module: `${basePath}.${match[3]}`,
          type: match[3] === '*' || match[3] === '_' ? 'wildcard import' : 'import',
          line: content.slice(0, match.index).split('\n').length
        });
      } else {
        imports.push({
          module: basePath,
          type: 'import',
          line: content.slice(0, match.index).split('\n').length
        });
      }
    }

    // Class declarations
    const classPattern = /(?:private|protected|final|abstract|sealed|case|\s)*\s*class\s+(\w+)(?:\s*\[[^\]]+\])?(?:\s*\([^)]*\))*(?:\s+extends\s+[^{]+)?\s*\{?/g;
    while ((match = classPattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPrivate = prefix.includes('private');
      classes.push({
        name: match[1],
        public: !isPrivate,
        line: content.slice(0, match.index).split('\n').length
      });
      if (!isPrivate) {
        exports.push({ name: match[1], type: 'class', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Object declarations (singletons)
    const objectPattern = /(?:private|protected|case|\s)*\s*object\s+(\w+)(?:\s+extends\s+[^{]+)?\s*\{/g;
    while ((match = objectPattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPrivate = prefix.includes('private');
      if (!isPrivate) {
        exports.push({ name: match[1], type: 'object', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Trait declarations
    const traitPattern = /(?:private|protected|sealed|\s)*\s*trait\s+(\w+)(?:\s*\[[^\]]+\])?(?:\s+extends\s+[^{]+)?\s*\{/g;
    while ((match = traitPattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPrivate = prefix.includes('private');
      if (!isPrivate) {
        exports.push({ name: match[1], type: 'trait', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Type alias declarations (Scala 3)
    const typePattern = /(?:private|protected|\s)*\s*type\s+(\w+)(?:\s*\[[^\]]+\])?\s*=/g;
    while ((match = typePattern.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 30), match.index);
      const isPrivate = prefix.includes('private');
      if (!isPrivate) {
        exports.push({ name: match[1], type: 'type', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Enum declarations (Scala 3)
    const enumPattern = /enum\s+(\w+)(?:\s*\[[^\]]+\])?(?:\s+extends\s+[^{:]+)?[:{]/g;
    while ((match = enumPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'enum', line: content.slice(0, match.index).split('\n').length });
    }

    // Given instances (Scala 3)
    const givenPattern = /given\s+(\w+)\s*:/g;
    while ((match = givenPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'given', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const hasMainMethod = /def\s+main\s*\(|@main\s+def/.test(content);
    const isTest = /import\s+org\.scalatest|import\s+org\.specs2|@Test/.test(content);
    const isAkka = /import\s+akka\./.test(content);
    const isPlayFramework = /import\s+play\./.test(content);

    return {
      imports,
      exports,
      classes,
      annotations: [],
      metadata: {
        parseMethod: 'scala-regex',
        packageName,
        hasMainMethod,
        isTest,
        isAkka,
        isPlayFramework
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
