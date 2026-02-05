// src/languages/javascript.mjs
// JavaScript/TypeScript language handler for Swynx
// Uses Babel AST for accurate parsing with regex fallback

import { parse as babelParse } from '@babel/parser';
import _traverse from '@babel/traverse';

// Handle both ESM and CJS default exports from @babel/traverse
const traverse = _traverse.default || _traverse;

// Language patterns from the knowledge base (set via initialize())
let languagePatterns = null;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize handler with language patterns from the knowledge base.
 * Called once by the language router before any parsing occurs.
 */
export function initialize(patterns) {
  languagePatterns = patterns;
}

/**
 * Parse a JavaScript/TypeScript file and return a standardized result.
 *
 * @param {string} filePath    - Relative path of the file
 * @param {string} content     - Full file content as a string
 * @returns {{ imports, exports, classes, functions, metadata }}
 */
export function parse(filePath, content) {
  // Handle Vue Single File Components (.vue)
  let scriptContent = content;
  let isVueSFC = false;
  let scriptLineOffset = 0;

  if (filePath.endsWith('.vue')) {
    isVueSFC = true;
    const scriptMatch = content.match(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/i);
    if (scriptMatch) {
      scriptContent = scriptMatch[1];
      // Calculate the line offset so AST line numbers map back to the full file
      const beforeScript = content.slice(0, scriptMatch.index);
      scriptLineOffset = (beforeScript.match(/\n/g) || []).length + 1;
    } else {
      // No <script> block found — return an empty but valid result
      return createEmptyResult('vue-no-script');
    }
  }

  try {
    return parseWithBabel(filePath, content, scriptContent, isVueSFC, scriptLineOffset);
  } catch (err) {
    // Babel could not handle this file — fall back to regex extraction
    return parseWithRegex(content);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Babel AST Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full AST parse using @babel/parser + @babel/traverse.
 * Extracts imports, exports, classes (with decorators), and functions.
 */
function parseWithBabel(filePath, fullContent, scriptContent, isVueSFC, lineOffset) {
  const ast = babelParse(scriptContent, {
    sourceType: 'unambiguous',
    plugins: [
      'jsx',
      'typescript',
      'decorators-legacy',
      'classProperties',
      'classPrivateProperties',
      'classPrivateMethods',
      'classStaticBlock',
      'exportDefaultFrom',
      'exportNamespaceFrom',
      'dynamicImport',
      'importMeta',
      'nullishCoalescingOperator',
      'optionalChaining',
      'optionalCatchBinding',
      'topLevelAwait',
      'asyncGenerators',
      'objectRestSpread',
      'numericSeparator',
      'bigInt',
      'throwExpressions',
      'regexpUnicodeSets',
      'importAttributes',
      'explicitResourceManagement',
      'sourcePhaseImports',
      'deferredImportEvaluation'
    ],
    errorRecovery: true,
    allowReturnOutsideFunction: true,
    allowSuperOutsideMethod: true,
    allowUndeclaredExports: true
  });

  const imports = [];
  const exports = [];
  const classes = [];
  const functions = [];

  // Helper: adjust line number for Vue SFC offset
  const L = (line) => (isVueSFC ? line + lineOffset : line);

  traverse(ast, {
    // ═════════════════════════════════════════════════════════════════════════
    // IMPORTS
    // ═════════════════════════════════════════════════════════════════════════

    ImportDeclaration(path) {
      const node = path.node;
      const source = node.source?.value;
      if (!source) return;

      imports.push({
        module: source,
        type: 'esm',
        line: L(node.loc?.start?.line || 0)
      });
    },

    // Dynamic import(): import('./module')
    Import(path) {
      const parent = path.parentPath;
      if (parent?.node?.type === 'CallExpression') {
        const arg = parent.node.arguments?.[0];
        if (arg?.type === 'StringLiteral' || arg?.type === 'Literal') {
          const modulePath = arg.value;
          if (modulePath) {
            imports.push({
              module: modulePath,
              type: 'dynamic-import',
              line: L(parent.node.loc?.start?.line || 0),
              isDynamic: true
            });
          }
        }
      }
    },

    // require(), glob.sync(), import.meta.glob(), require.context()
    CallExpression(path) {
      const node = path.node;

      // Dynamic import() as CallExpression (older parser versions)
      if (node.callee?.type === 'Import' && node.arguments?.[0]) {
        const arg = node.arguments[0];
        const modulePath = arg.value || arg.quasis?.[0]?.value?.raw;
        if (modulePath && typeof modulePath === 'string') {
          imports.push({
            module: modulePath,
            type: 'dynamic-import',
            line: L(node.loc?.start?.line || 0),
            isDynamic: true
          });
        }
      }

      // require('module')
      if (node.callee?.name === 'require' && node.arguments?.[0]?.value) {
        imports.push({
          module: node.arguments[0].value,
          type: 'commonjs',
          line: L(node.loc?.start?.line || 0)
        });
      }

      // require.resolve('module')
      if (node.callee?.type === 'MemberExpression' &&
          node.callee.object?.name === 'require' &&
          node.callee.property?.name === 'resolve' &&
          node.arguments?.[0]?.value) {
        imports.push({
          module: node.arguments[0].value,
          type: 'require-resolve',
          line: L(node.loc?.start?.line || 0),
          isDynamic: true
        });
      }

      // glob.sync('**/*.ts')
      if (node.callee?.type === 'MemberExpression' &&
          node.callee.object?.name === 'glob' &&
          node.callee.property?.name === 'sync') {
        const pattern = node.arguments?.[0]?.value;
        if (pattern && typeof pattern === 'string') {
          imports.push({
            module: pattern,
            type: 'glob-sync',
            line: L(node.loc?.start?.line || 0),
            isGlob: true
          });
        }
      }

      // globSync('**/*.ts') — glob v9+ named export
      if (node.callee?.name === 'globSync' && node.arguments?.[0]?.value) {
        const pattern = node.arguments[0].value;
        if (typeof pattern === 'string') {
          imports.push({
            module: pattern,
            type: 'glob-sync',
            line: L(node.loc?.start?.line || 0),
            isGlob: true
          });
        }
      }

      // import.meta.glob('**/*.ts') — Vite
      if (node.callee?.type === 'MemberExpression' &&
          node.callee.object?.type === 'MetaProperty' &&
          node.callee.property?.name === 'glob') {
        const pattern = node.arguments?.[0]?.value;
        if (pattern && typeof pattern === 'string') {
          imports.push({
            module: pattern,
            type: 'import-meta-glob',
            line: L(node.loc?.start?.line || 0),
            isGlob: true
          });
        }
      }

      // require.context('./', true, /\.ts$/) — Webpack
      if (node.callee?.type === 'MemberExpression' &&
          node.callee.object?.name === 'require' &&
          node.callee.property?.name === 'context') {
        const dir = node.arguments?.[0]?.value;
        if (dir) {
          imports.push({
            module: dir,
            type: 'require-context',
            line: L(node.loc?.start?.line || 0),
            isGlob: true
          });
        }
      }
    },

    // ═════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═════════════════════════════════════════════════════════════════════════

    ExportNamedDeclaration(path) {
      const node = path.node;
      const decl = node.declaration;

      if (decl) {
        if (decl.type === 'FunctionDeclaration' && decl.id) {
          exports.push({
            name: decl.id.name,
            type: 'function',
            line: L(node.loc?.start?.line || 0)
          });
        } else if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations) {
            if (d.id?.name) {
              exports.push({
                name: d.id.name,
                type: 'variable',
                line: L(node.loc?.start?.line || 0)
              });
            }
          }
        } else if (decl.type === 'ClassDeclaration' && decl.id) {
          exports.push({
            name: decl.id.name,
            type: 'class',
            line: L(node.loc?.start?.line || 0)
          });
        } else if (decl.type === 'TSTypeAliasDeclaration' && decl.id) {
          exports.push({
            name: decl.id.name,
            type: 'type',
            line: L(node.loc?.start?.line || 0)
          });
        } else if (decl.type === 'TSInterfaceDeclaration' && decl.id) {
          exports.push({
            name: decl.id.name,
            type: 'interface',
            line: L(node.loc?.start?.line || 0)
          });
        } else if (decl.type === 'TSEnumDeclaration' && decl.id) {
          exports.push({
            name: decl.id.name,
            type: 'enum',
            line: L(node.loc?.start?.line || 0)
          });
        }
      }

      // export { foo, bar } or export { foo } from './module'
      for (const spec of node.specifiers || []) {
        exports.push({
          name: spec.exported?.name || spec.local?.name,
          type: 'reexport',
          line: L(node.loc?.start?.line || 0),
          sourceModule: node.source?.value || null
        });
      }
    },

    ExportAllDeclaration(path) {
      exports.push({
        name: '*',
        type: 'reexport-all',
        line: L(path.node.loc?.start?.line || 0),
        sourceModule: path.node.source?.value || null
      });
    },

    ExportDefaultDeclaration(path) {
      const node = path.node;
      let name = 'default';

      if (node.declaration) {
        if (node.declaration.id?.name) {
          name = node.declaration.id.name;
        } else if (node.declaration.type === 'Identifier') {
          name = node.declaration.name;
        }
      }

      exports.push({
        name,
        type: 'default',
        line: L(node.loc?.start?.line || 0),
        isDefault: true
      });
    },

    // ═════════════════════════════════════════════════════════════════════════
    // CLASSES
    // ═════════════════════════════════════════════════════════════════════════

    ClassDeclaration(path) {
      const node = path.node;
      if (!node.id) return;

      const classInfo = {
        name: node.id.name,
        type: 'class',
        line: L(node.loc?.start?.line || 0),
        endLine: L(node.loc?.end?.line || 0),
        decorators: extractDecorators(node.decorators, lineOffset, isVueSFC),
        methods: []
      };

      // Extract methods and function-valued properties
      if (node.body && node.body.body) {
        for (const member of node.body.body) {
          if (member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') {
            classInfo.methods.push(extractMethodInfo(member, isVueSFC, lineOffset));
          } else if (member.type === 'ClassProperty' || member.type === 'ClassPrivateProperty') {
            if (member.value?.type === 'ArrowFunctionExpression' ||
                member.value?.type === 'FunctionExpression') {
              const methodName = member.key?.name || member.key?.id?.name || 'anonymous';
              classInfo.methods.push({
                name: methodName,
                type: 'property',
                line: L(member.loc?.start?.line || 0),
                endLine: L(member.loc?.end?.line || 0),
                params: extractParams(member.value.params),
                async: member.value.async || false
              });
            }
          }
        }
      }

      classes.push(classInfo);
    },

    // ═════════════════════════════════════════════════════════════════════════
    // FUNCTIONS
    // ═════════════════════════════════════════════════════════════════════════

    // function declarations: function name() {}
    FunctionDeclaration(path) {
      if (!path.node.id) return;

      const node = path.node;
      functions.push({
        name: node.id.name,
        type: 'function',
        line: L(node.loc?.start?.line || 0),
        endLine: L(node.loc?.end?.line || 0),
        params: extractParams(node.params),
        async: node.async || false
      });
    },

    // Arrow / function expressions assigned to a variable
    VariableDeclarator(path) {
      const init = path.node.init;
      if (!init) return;
      if (!path.node.id || path.node.id.type !== 'Identifier') return;

      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
        const name = path.node.id.name;

        // Use the variable declaration line as the start
        const parent = path.parentPath?.node;
        const startLine = parent?.loc?.start?.line || init.loc?.start?.line || 0;
        const endLine = init.loc?.end?.line || 0;

        functions.push({
          name,
          type: init.type === 'ArrowFunctionExpression' ? 'arrow' : 'expression',
          line: L(startLine),
          endLine: L(endLine),
          params: extractParams(init.params),
          async: init.async || false
        });
      }
    },

    // Object methods: { methodName() {} }
    ObjectMethod(path) {
      if (!path.node.key) return;

      const name = path.node.key.name || path.node.key.value || 'anonymous';
      const node = path.node;

      functions.push({
        name,
        type: 'method',
        line: L(node.loc?.start?.line || 0),
        endLine: L(node.loc?.end?.line || 0),
        params: extractParams(node.params),
        async: node.async || false
      });
    },

    // Object properties with function values: { name: () => {} }
    ObjectProperty(path) {
      const value = path.node.value;
      if (!value) return;

      if (value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression') {
        const name = path.node.key?.name || path.node.key?.value || 'anonymous';

        functions.push({
          name,
          type: 'property',
          line: L(path.node.loc?.start?.line || 0),
          endLine: L(path.node.loc?.end?.line || 0),
          params: extractParams(value.params),
          async: value.async || false
        });
      }
    }
  });

  // Sort by source order
  functions.sort((a, b) => a.line - b.line);
  classes.sort((a, b) => a.line - b.line);

  return {
    imports,
    exports,
    classes,
    functions,
    metadata: {
      parseMethod: isVueSFC ? 'babel-ast-vue' : 'babel-ast'
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AST Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract parameter names from an AST params array.
 */
function extractParams(params) {
  const result = [];
  for (const param of params || []) {
    switch (param.type) {
      case 'Identifier':
        result.push(param.name);
        break;
      case 'AssignmentPattern':
        if (param.left?.name) result.push(`${param.left.name}=`);
        else if (param.left?.type === 'ObjectPattern') result.push('{...}=');
        else if (param.left?.type === 'ArrayPattern') result.push('[...]=');
        break;
      case 'RestElement':
        if (param.argument?.name) result.push(`...${param.argument.name}`);
        else result.push('...');
        break;
      case 'ObjectPattern':
        result.push('{...}');
        break;
      case 'ArrayPattern':
        result.push('[...]');
        break;
      case 'TSParameterProperty':
        // TypeScript constructor shorthand (public x: number)
        if (param.parameter?.name) result.push(param.parameter.name);
        else if (param.parameter?.left?.name) result.push(`${param.parameter.left.name}=`);
        break;
      default:
        result.push('?');
        break;
    }
  }
  return result;
}

/**
 * Extract decorator information from a class node.
 */
function extractDecorators(decorators, lineOffset, isVueSFC) {
  if (!decorators || decorators.length === 0) return [];

  const L = (line) => (isVueSFC ? line + lineOffset : line);

  return decorators.map(dec => {
    const expr = dec.expression;
    let name = null;
    let args = null;

    if (expr.type === 'CallExpression') {
      // @Service() or @Module({ imports: [...] })
      name = expr.callee?.name || expr.callee?.property?.name || null;

      // Extract first argument if it is an object literal
      if (expr.arguments?.[0]?.type === 'ObjectExpression') {
        args = {};
        for (const prop of expr.arguments[0].properties || []) {
          if (prop.key?.name && prop.value) {
            if (prop.value.type === 'StringLiteral' || prop.value.type === 'Literal') {
              args[prop.key.name] = prop.value.value;
            } else if (prop.value.type === 'Identifier') {
              args[prop.key.name] = prop.value.name;
            }
          }
        }
      }
    } else if (expr.type === 'Identifier') {
      // @Service (no parentheses)
      name = expr.name;
    } else if (expr.type === 'MemberExpression') {
      // @Module.Service
      name = expr.property?.name || null;
    }

    return { name, args, line: L(dec.loc?.start?.line || 0) };
  }).filter(d => d.name);
}

/**
 * Extract method information from a ClassMethod / ClassPrivateMethod node.
 */
function extractMethodInfo(node, isVueSFC, lineOffset) {
  const L = (line) => (isVueSFC ? line + lineOffset : line);

  let name = 'anonymous';
  if (node.key) {
    if (node.key.type === 'Identifier') {
      name = node.key.name;
    } else if (node.key.type === 'PrivateName') {
      name = `#${node.key.id?.name || 'private'}`;
    } else if (node.key.type === 'StringLiteral') {
      name = node.key.value;
    }
  }

  return {
    name,
    type: node.kind || 'method', // constructor, method, get, set
    line: L(node.loc?.start?.line || 0),
    endLine: L(node.loc?.end?.line || 0),
    params: extractParams(node.params),
    async: node.async || false,
    static: node.static || false
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Regex Fallback Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Regex-based extraction used when Babel cannot parse the file.
 * Catches the most common patterns: functions, classes, imports, exports.
 */
function parseWithRegex(content) {
  const lines = content.split('\n');

  const imports = [];
  const exports = [];
  const classes = [];
  const functions = [];

  const functionPatterns = [
    // function declarations
    { re: /^(\s*)(export\s+)?(async\s+)?function\s*\*?\s*(\w+)\s*\(/, type: 'function', nameIdx: 4 },
    // arrow functions: const name = (args) => ...
    { re: /^(\s*)(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\([^)]*\)\s*=>/, type: 'arrow', nameIdx: 4 },
    // arrow functions: const name = arg => ...
    { re: /^(\s*)(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?(\w+)\s*=>/, type: 'arrow', nameIdx: 4 },
    // class declarations
    { re: /^(\s*)(export\s+)?class\s+(\w+)/, type: 'class', nameIdx: 3 }
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Functions and classes ──
    for (const { re, type, nameIdx } of functionPatterns) {
      const match = line.match(re);
      if (!match) continue;

      const startLine = i + 1;
      const endLine = findBlockEnd(lines, i);
      const name = match[nameIdx] || 'anonymous';

      if (type === 'class') {
        classes.push({
          name,
          type: 'class',
          line: startLine,
          endLine,
          decorators: [],
          methods: []
        });
      } else {
        const isAsync = !!(match[3]?.trim() === 'async' || match[5]?.trim() === 'async');
        functions.push({
          name,
          type,
          line: startLine,
          endLine,
          params: [],
          async: isAsync
        });
      }
      break; // only match first pattern per line
    }

    // ── ESM imports ──
    const esmImport = line.match(/^\s*import\s+.*?from\s+['"]([^'"]+)['"]/);
    if (esmImport) {
      imports.push({ module: esmImport[1], type: 'esm', line: i + 1 });
    }

    // ── Side-effect imports: import 'module' ──
    if (!esmImport) {
      const sideEffect = line.match(/^\s*import\s+['"]([^'"]+)['"]/);
      if (sideEffect) {
        imports.push({ module: sideEffect[1], type: 'esm', line: i + 1 });
      }
    }

    // ── require() ──
    const requireMatch = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch) {
      imports.push({ module: requireMatch[1], type: 'commonjs', line: i + 1 });
    }

    // ── Dynamic import() ──
    const dynamicImport = line.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (dynamicImport) {
      imports.push({ module: dynamicImport[1], type: 'dynamic-import', line: i + 1, isDynamic: true });
    }

    // ── Exports ──
    if (/^\s*export\s+/.test(line)) {
      // export default
      if (/^\s*export\s+default\s+/.test(line)) {
        const defaultMatch = line.match(/export\s+default\s+(?:function|class)?\s*(\w+)?/);
        exports.push({
          name: defaultMatch?.[1] || 'default',
          type: 'default',
          line: i + 1,
          isDefault: true
        });
      }
      // export { ... } from 'module'
      else if (/^\s*export\s*\{/.test(line)) {
        const reexportSource = line.match(/from\s+['"]([^'"]+)['"]/);
        const names = line.match(/\{([^}]+)\}/);
        if (names) {
          for (const raw of names[1].split(',')) {
            const n = raw.trim().split(/\s+as\s+/).pop().trim();
            if (n) {
              exports.push({
                name: n,
                type: 'reexport',
                line: i + 1,
                sourceModule: reexportSource?.[1] || null
              });
            }
          }
        }
      }
      // export * from 'module'
      else if (/^\s*export\s+\*\s+from\s+/.test(line)) {
        const srcMatch = line.match(/from\s+['"]([^'"]+)['"]/);
        exports.push({
          name: '*',
          type: 'reexport-all',
          line: i + 1,
          sourceModule: srcMatch?.[1] || null
        });
      }
      // export function / class / const / let / var
      else {
        const namedMatch = line.match(/export\s+(function|class|const|let|var)\s+(\w+)/);
        if (namedMatch) {
          exports.push({
            name: namedMatch[2],
            type: namedMatch[1],
            line: i + 1
          });
        }
      }
    }
  }

  return {
    imports,
    exports,
    classes,
    functions,
    metadata: { parseMethod: 'regex-fallback' }
  };
}

/**
 * Find the closing brace of a block that starts on or after `startIndex`.
 * Returns the 1-based line number of the closing brace.
 */
function findBlockEnd(lines, startIndex) {
  let braceDepth = 0;
  let started = false;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];

    let inString = false;
    let stringChar = '';

    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const next = line[j + 1];

      // Toggle string state
      if (!inString && (ch === '"' || ch === "'" || ch === '`')) {
        inString = true;
        stringChar = ch;
        continue;
      }
      if (inString && ch === stringChar && line[j - 1] !== '\\') {
        inString = false;
        continue;
      }
      if (inString) continue;

      // Skip single-line comments
      if (ch === '/' && next === '/') break;

      // Track braces
      if (ch === '{') {
        braceDepth++;
        started = true;
      } else if (ch === '}') {
        braceDepth--;
        if (started && braceDepth === 0) {
          return i + 1; // 1-based
        }
      }
    }
  }

  return startIndex + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function createEmptyResult(parseMethod) {
  return {
    imports: [],
    exports: [],
    classes: [],
    functions: [],
    metadata: { parseMethod }
  };
}

export default { parse, initialize };
