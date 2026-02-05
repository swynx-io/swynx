// src/languages/go.mjs
// Go parser with Wire, Fx, Dig DI framework support
// Extracted from swynx/src/scanner/parsers/go.mjs

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const lines = content.split('\n');
    const functions = [];
    const classes = []; // Structs and interfaces
    const exports = [];
    const imports = [];
    let packageName = null;

    // Package declaration
    const packageMatch = content.match(/^\s*package\s+(\w+)/m);
    if (packageMatch) {
      packageName = packageMatch[1];
    }

    // Single imports
    const singleImportPattern = /^\s*import\s+"([^"]+)"/gm;
    let match;
    while ((match = singleImportPattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      imports.push({ module: match[1], type: 'single', line: lineNum });
    }

    // Multi-import block
    const importBlockMatch = content.match(/import\s*\(([\s\S]*?)\)/);
    if (importBlockMatch) {
      const blockStart = content.indexOf(importBlockMatch[0]);
      const blockLines = importBlockMatch[1].split('\n');
      let blockLineNum = content.substring(0, blockStart).split('\n').length;

      for (const importLine of blockLines) {
        blockLineNum++;
        const importMatch = importLine.match(/^\s*(?:(\w+)\s+)?["']([^"']+)["']/);
        if (importMatch) {
          imports.push({
            module: importMatch[2],
            alias: importMatch[1] || null,
            type: 'block',
            line: blockLineNum
          });
        }
      }
    }

    // Functions and methods
    const funcPattern = /^func\s+(?:\(([^)]+)\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*\(([^)]*)\)|\s*(\w+))?/gm;
    while ((match = funcPattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const receiver = match[1] || null;
      const funcName = match[2];

      const funcInfo = {
        name: funcName,
        type: receiver ? 'method' : 'function',
        receiver: receiver ? parseReceiver(receiver) : null,
        line: lineNum,
        endLine: findBlockEnd(lines, lineNum - 1),
        params: parseGoParams(match[3] || ''),
        returnType: match[4] || match[5] || null,
        signature: `func ${receiver ? `(${receiver}) ` : ''}${funcName}(${match[3] || ''})`,
        exported: funcName[0] === funcName[0].toUpperCase()
      };

      funcInfo.lineCount = funcInfo.endLine - funcInfo.line + 1;

      if (funcName === 'main' && packageName === 'main' && !receiver) {
        funcInfo.isMainFunction = true;
      }
      if (funcName === 'init' && !receiver) {
        funcInfo.isInitFunction = true;
      }

      functions.push(funcInfo);
    }

    // Structs
    const structPattern = /^type\s+(\w+)\s+struct\s*\{/gm;
    while ((match = structPattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const structInfo = {
        name: match[1],
        type: 'struct',
        line: lineNum,
        endLine: findBlockEnd(lines, lineNum - 1),
        fields: [],
        methods: functions.filter(f => f.receiver?.type?.replace('*', '') === match[1]),
        exported: match[1][0] === match[1][0].toUpperCase()
      };
      structInfo.lineCount = structInfo.endLine - structInfo.line + 1;
      parseStructFields(lines, structInfo);
      classes.push(structInfo);
    }

    // Interfaces
    const interfacePattern = /^type\s+(\w+)\s+interface\s*\{/gm;
    while ((match = interfacePattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const interfaceInfo = {
        name: match[1],
        type: 'interface',
        line: lineNum,
        endLine: findBlockEnd(lines, lineNum - 1),
        methods: [],
        exported: match[1][0] === match[1][0].toUpperCase()
      };
      interfaceInfo.lineCount = interfaceInfo.endLine - interfaceInfo.line + 1;
      classes.push(interfaceInfo);
    }

    // Build exports
    for (const f of functions.filter(f => f.exported && !f.receiver)) {
      exports.push({ name: f.name, type: 'function', line: f.line });
    }
    for (const c of classes.filter(c => c.exported)) {
      exports.push({ name: c.name, type: c.type, line: c.line });
    }

    // Exported constants/vars
    const constPattern = /^(?:const|var)\s+(\w+)\s+/gm;
    while ((match = constPattern.exec(content)) !== null) {
      if (match[1][0] === match[1][0].toUpperCase()) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        exports.push({ name: match[1], type: 'const/var', line: lineNum });
      }
    }

    // DI framework detection
    const usesWire = content.includes('wire.Build') || content.includes('wire.NewSet');
    const usesFx = content.includes('fx.New') || content.includes('fx.Provide');
    const usesDig = content.includes('dig.New') || content.includes('container.Provide');

    return {
      imports,
      exports,
      classes,
      functions,
      annotations: [],
      metadata: {
        parseMethod: 'go-regex',
        packageName,
        hasMainFunction: functions.some(f => f.isMainFunction),
        hasInitFunction: functions.some(f => f.isInitFunction),
        isMainPackage: packageName === 'main',
        usesWire, usesFx, usesDig,
        isTestFile: filePath.endsWith('_test.go')
      }
    };
  } catch (error) {
    return createEmptyResult(filePath, `Parse error: ${error.message}`);
  }
}

function parseReceiver(receiver) {
  const match = receiver.match(/(\w+)\s+([\w*]+)/);
  if (match) return { name: match[1], type: match[2] };
  return { name: '', type: receiver.trim() };
}

function parseGoParams(paramsStr) {
  if (!paramsStr || !paramsStr.trim()) return [];
  const params = [];
  let current = '';
  let depth = 0;

  for (const char of paramsStr) {
    if (char === '[' || char === '(' || char === '{') depth++;
    else if (char === ']' || char === ')' || char === '}') depth--;
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

function parseStructFields(lines, structInfo) {
  for (let i = structInfo.line; i < structInfo.endLine - 1 && i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//') || line.startsWith('/*') || line === '{') continue;

    const fieldMatch = line.match(/^(\w+)\s+([\w*\[\].]+)(?:\s+`([^`]+)`)?/);
    if (fieldMatch) {
      structInfo.fields.push({
        name: fieldMatch[1],
        type: fieldMatch[2],
        tags: fieldMatch[3] || null,
        exported: fieldMatch[1][0] === fieldMatch[1][0].toUpperCase()
      });
    }
  }
}

function findBlockEnd(lines, startIndex) {
  let braceCount = 0;
  let started = false;

  for (let i = startIndex; i < lines.length; i++) {
    for (const char of lines[i]) {
      if (char === '{') { braceCount++; started = true; }
      else if (char === '}') {
        braceCount--;
        if (started && braceCount === 0) return i + 1;
      }
    }
  }
  return startIndex + 1;
}

function createEmptyResult(filePath, error = null) {
  return {
    imports: [], exports: [], classes: [], functions: [], annotations: [],
    metadata: { parseMethod: 'none', error }
  };
}

export default { parse, initialize };
