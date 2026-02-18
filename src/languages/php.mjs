// src/languages/php.mjs
// PHP parser with Laravel, Symfony, WordPress support

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
    const functions = [];
    const traits = [];

    // Namespace declaration
    const namespaceMatch = content.match(/namespace\s+([\w\\]+)\s*;/);
    const namespace = namespaceMatch ? namespaceMatch[1] : null;

    // Use statements (imports)
    const usePattern = /use\s+([\w\\]+)(?:\s+as\s+(\w+))?(?:\s*,\s*([\w\\]+)(?:\s+as\s+(\w+))?)*\s*;/g;
    let match;
    while ((match = usePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        alias: match[2] || null,
        type: 'use',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Function imports (use function)
    const useFunctionPattern = /use\s+function\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/g;
    while ((match = useFunctionPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        alias: match[2] || null,
        type: 'use function',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Require/include statements
    const requirePatterns = [
      /require(?:_once)?\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /require(?:_once)?\s+['"]([^'"]+)['"]/g,
      /include(?:_once)?\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /include(?:_once)?\s+['"]([^'"]+)['"]/g
    ];
    for (const pattern of requirePatterns) {
      while ((match = pattern.exec(content)) !== null) {
        imports.push({
          module: match[1],
          type: pattern.source.includes('require') ? 'require' : 'include',
          line: content.slice(0, match.index).split('\n').length
        });
      }
    }

    // Class declarations
    const classPattern = /(?:abstract\s+|final\s+)?class\s+(\w+)(?:\s+extends\s+([\w\\]+))?(?:\s+implements\s+([\w\\,\s]+))?\s*\{/g;
    while ((match = classPattern.exec(content)) !== null) {
      const classInfo = {
        name: match[1],
        type: 'class',
        extends: match[2] || null,
        implements: match[3] ? match[3].split(',').map(s => s.trim()) : [],
        line: content.slice(0, match.index).split('\n').length,
        exported: true
      };
      classes.push(classInfo);
      exports.push({ name: match[1], type: 'class', line: classInfo.line });
    }

    // Interface declarations
    const interfacePattern = /interface\s+(\w+)(?:\s+extends\s+([\w\\,\s]+))?\s*\{/g;
    while ((match = interfacePattern.exec(content)) !== null) {
      classes.push({
        name: match[1],
        type: 'interface',
        extends: match[2] ? match[2].split(',').map(s => s.trim()) : [],
        line: content.slice(0, match.index).split('\n').length,
        exported: true
      });
      exports.push({ name: match[1], type: 'interface', line: content.slice(0, match.index).split('\n').length });
    }

    // Trait declarations
    const traitPattern = /trait\s+(\w+)\s*\{/g;
    while ((match = traitPattern.exec(content)) !== null) {
      traits.push({
        name: match[1],
        line: content.slice(0, match.index).split('\n').length
      });
      exports.push({ name: match[1], type: 'trait', line: content.slice(0, match.index).split('\n').length });
    }

    // Function declarations (outside classes)
    const functionPattern = /(?:^|\n)\s*function\s+(\w+)\s*\(/g;
    while ((match = functionPattern.exec(content)) !== null) {
      const funcName = match[1];
      const line = content.slice(0, match.index).split('\n').length;
      functions.push({
        name: funcName,
        type: 'function',
        line,
        exported: true
      });
      exports.push({ name: funcName, type: 'function', line });
    }

    // Detect framework patterns
    const isLaravel = content.includes('Illuminate\\') ||
                      content.includes('extends Controller') ||
                      content.includes('extends Model');
    const isSymfony = content.includes('Symfony\\') ||
                      content.includes('#[Route') ||
                      content.includes('@Route');
    const isWordPress = content.includes('add_action') ||
                        content.includes('add_filter') ||
                        content.includes('wp_') ||
                        /Plugin Name:/i.test(content);

    return {
      imports,
      exports,
      classes,
      functions,
      traits,
      annotations: [],
      metadata: {
        parseMethod: 'php-regex',
        namespace,
        isLaravel,
        isSymfony,
        isWordPress,
        isTest: /Test\.php$/.test(filePath) || /\/tests?\//.test(filePath) ||
                classes.some(c => c.name.endsWith('Test') || (c.extends && c.extends.includes('TestCase'))),
        isController: classes.some(c => c.name.includes('Controller') || (c.extends && c.extends.includes('Controller'))),
        isModel: classes.some(c => c.extends && (c.extends.includes('Model') || c.extends.includes('Eloquent'))),
        isMigration: classes.some(c => c.extends && c.extends.includes('Migration'))
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
    functions: [],
    traits: [],
    annotations: [],
    metadata: { parseMethod: 'none', error }
  };
}

export default { parse, initialize };
