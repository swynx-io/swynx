// src/languages/python.mjs
// Python parser with Django, FastAPI, Flask, Celery support
// Extracted from peer-audit/src/scanner/parsers/python.mjs

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const lines = content.split('\n');
    const functions = [];
    const classes = [];
    const decorators = [];
    const imports = [];

    let pendingDecorators = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Import statements
      const importMatch = line.match(/^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/);
      if (importMatch) {
        imports.push({
          module: importMatch[1],
          alias: importMatch[2] || null,
          type: 'import',
          line: lineNum
        });
        continue;
      }

      // From ... import statements (single and multi-line)
      const fromImportMatch = line.match(/^\s*from\s+([\w.]+)\s+import\s+(.+)/);
      if (fromImportMatch) {
        const module = fromImportMatch[1];
        let importedText = fromImportMatch[2].trim();

        // Multi-line parenthetical imports
        if (importedText.startsWith('(') && !importedText.includes(')')) {
          importedText = importedText.slice(1);
          for (let j = i + 1; j < lines.length; j++) {
            const nextLine = lines[j].trim();
            if (nextLine.includes(')')) {
              importedText += ',' + nextLine.replace(')', '');
              i = j;
              break;
            }
            importedText += ',' + nextLine;
          }
        } else if (importedText.startsWith('(') && importedText.includes(')')) {
          importedText = importedText.replace(/[()]/g, '');
        }

        const importedItems = importedText.split(',').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
        const isDotsOnly = /^\.+$/.test(module);

        for (const item of importedItems) {
          if (item.trim() === '*') {
            imports.push({ module, name: '*', alias: null, type: 'from', line: lineNum });
            continue;
          }
          const aliasMatch = item.match(/(\w+)(?:\s+as\s+(\w+))?/);
          if (aliasMatch) {
            imports.push({
              module: isDotsOnly ? `${module}${aliasMatch[1]}` : module,
              name: aliasMatch[1],
              alias: aliasMatch[2] || null,
              type: 'from',
              line: lineNum
            });
          }
        }
        continue;
      }

      // Decorators
      const decoratorMatch = line.match(/^\s*@([\w.]+)(?:\(([^)]*)\))?/);
      if (decoratorMatch) {
        const decorator = {
          name: decoratorMatch[1],
          args: decoratorMatch[2] || null,
          line: lineNum
        };
        decorators.push(decorator);
        pendingDecorators.push(decorator);
        continue;
      }

      // Class declaration
      const classMatch = line.match(/^(\s*)class\s+(\w+)(?:\(([^)]*)\))?:/);
      if (classMatch) {
        const indent = classMatch[1].length;
        const baseClasses = classMatch[3] ? classMatch[3].split(',').map(s => s.trim()) : [];

        const classInfo = {
          name: classMatch[2],
          type: 'class',
          line: lineNum,
          endLine: findIndentBlockEnd(lines, i, indent),
          indent,
          baseClasses,
          decorators: [...pendingDecorators],
          methods: [],
          exported: !classMatch[2].startsWith('_')
        };

        classInfo.lineCount = classInfo.endLine - classInfo.line + 1;
        parseClassMethods(lines, classInfo, functions);
        classes.push(classInfo);
        pendingDecorators = [];
        continue;
      }

      // Module-level function declaration
      const funcMatch = line.match(/^(\s*)(async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([\w\[\],\s.]+))?:/);
      if (funcMatch && funcMatch[1].length === 0) {
        const funcInfo = {
          name: funcMatch[3],
          type: funcMatch[2] ? 'async function' : 'function',
          async: !!funcMatch[2],
          line: lineNum,
          endLine: findIndentBlockEnd(lines, i, 0),
          params: parseParams(funcMatch[4]),
          returnType: funcMatch[5]?.trim() || null,
          decorators: [...pendingDecorators],
          signature: `def ${funcMatch[3]}(${funcMatch[4]})`,
          exported: !funcMatch[3].startsWith('_')
        };

        funcInfo.lineCount = funcInfo.endLine - funcInfo.line + 1;
        functions.push(funcInfo);
        pendingDecorators = [];
        continue;
      }

      // Clear pending decorators on non-decorator, non-empty lines
      if (line.trim() && !line.trim().startsWith('#')) {
        pendingDecorators = [];
      }
    }

    const hasMainBlock = content.includes('if __name__ == "__main__"') ||
                         content.includes("if __name__ == '__main__'");

    // Build exports
    const exports = [];

    // Check for __all__
    const allMatch = content.match(/__all__\s*=\s*\[([\s\S]*?)\]/);
    if (allMatch) {
      const exportNames = allMatch[1].match(/['"](\w+)['"]/g);
      if (exportNames) {
        for (const name of exportNames) {
          exports.push({ name: name.replace(/['"]/g, ''), type: 'explicit', line: 0 });
        }
      }
    } else {
      for (const f of functions.filter(f => f.exported)) {
        exports.push({ name: f.name, type: 'function', line: f.line });
      }
      for (const c of classes.filter(c => c.exported)) {
        exports.push({ name: c.name, type: 'class', line: c.line });
      }
    }

    return {
      imports,
      exports,
      classes,
      functions,
      annotations: decorators,
      metadata: {
        parseMethod: 'python-regex',
        hasMainBlock,
        isDjangoModel: classes.some(c =>
          c.baseClasses.some(b => b.includes('Model') || b.includes('models.Model'))
        ),
        isDjangoView: classes.some(c =>
          c.baseClasses.some(b => b.includes('View') || b.includes('APIView') || b.includes('ViewSet'))
        ),
        isFastAPI: decorators.some(d =>
          d.name.includes('app.') || d.name.includes('router.') || d.name === 'Depends'
        ),
        isFlask: decorators.some(d =>
          d.name.includes('route') || d.name.includes('Blueprint')
        ),
        isCelery: decorators.some(d =>
          d.name === 'task' || d.name === 'shared_task' || d.name.includes('celery.')
        )
      }
    };
  } catch (error) {
    return createEmptyResult(filePath, `Parse error: ${error.message}`);
  }
}

function parseClassMethods(lines, classInfo, allFunctions) {
  const classIndent = classInfo.indent;

  for (let i = classInfo.line; i < classInfo.endLine - 1 && i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const methodMatch = line.match(/^(\s+)(async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([\w\[\],\s.]+))?:/);
    if (methodMatch) {
      const methodIndent = methodMatch[1].length;
      if (methodIndent > classIndent) {
        const methodDecorators = [];
        for (let j = i - 1; j >= classInfo.line; j--) {
          const prevLine = lines[j];
          const decMatch = prevLine.match(/^\s+@([\w.]+)(?:\(([^)]*)\))?/);
          if (decMatch) {
            methodDecorators.unshift({ name: decMatch[1], args: decMatch[2] || null, line: j + 1 });
          } else if (prevLine.trim() && !prevLine.trim().startsWith('#')) {
            break;
          }
        }

        const methodInfo = {
          name: methodMatch[3],
          type: methodMatch[2] ? 'async method' : 'method',
          async: !!methodMatch[2],
          className: classInfo.name,
          line: lineNum,
          endLine: findIndentBlockEnd(lines, i, methodIndent),
          params: parseParams(methodMatch[4]),
          returnType: methodMatch[5]?.trim() || null,
          decorators: methodDecorators,
          signature: `def ${methodMatch[3]}(${methodMatch[4]})`,
          isStatic: methodDecorators.some(d => d.name === 'staticmethod'),
          isClassMethod: methodDecorators.some(d => d.name === 'classmethod'),
          isProperty: methodDecorators.some(d => d.name === 'property')
        };

        methodInfo.lineCount = methodInfo.endLine - methodInfo.line + 1;
        classInfo.methods.push(methodInfo);
        allFunctions.push(methodInfo);
      }
    }
  }
}

function parseParams(paramsStr) {
  if (!paramsStr || !paramsStr.trim()) return [];
  const params = [];
  let depth = 0;
  let current = '';

  for (const char of paramsStr) {
    if (char === '[' || char === '(') depth++;
    else if (char === ']' || char === ')') depth--;
    else if (char === ',' && depth === 0) {
      if (current.trim()) params.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) params.push(current.trim());
  return params;
}

function findIndentBlockEnd(lines, startIndex, baseIndent) {
  const firstIndent = lines[startIndex].match(/^(\s*)/)[1].length;
  const targetIndent = baseIndent === 0 ? firstIndent : baseIndent;

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.match(/^(\s*)/)[1].length;
    if (baseIndent === 0) {
      if (indent === 0 && line.trim()) return i;
    } else {
      if (indent <= targetIndent && line.trim()) return i;
    }
  }
  return lines.length;
}

function createEmptyResult(filePath, error = null) {
  return {
    imports: [],
    exports: [],
    classes: [],
    functions: [],
    annotations: [],
    metadata: { parseMethod: 'none', error }
  };
}

export default { parse, initialize };
