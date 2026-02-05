// src/languages/nim.mjs
// Nim parser for import, include, from declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // import statements
    const importPattern = /import\s+([\w\/,\s]+)/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      const modules = match[1].split(',').map(m => m.trim());
      for (const module of modules) {
        if (module && !module.startsWith('except')) {
          imports.push({
            module: module.replace(/\//g, '.'),
            type: 'import',
            line: content.slice(0, match.index).split('\n').length
          });
        }
      }
    }

    // from X import Y statements
    const fromPattern = /from\s+([\w\/]+)\s+import\s+([\w,\s]+)/g;
    while ((match = fromPattern.exec(content)) !== null) {
      imports.push({
        module: match[1].replace(/\//g, '.'),
        type: 'from import',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // include statements
    const includePattern = /include\s+([\w\/]+)/g;
    while ((match = includePattern.exec(content)) !== null) {
      imports.push({
        module: match[1].replace(/\//g, '.'),
        type: 'include',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // proc definitions (exported with *)
    const procPattern = /proc\s+(\w+)\*?\s*(?:\[|[(\s=])/g;
    while ((match = procPattern.exec(content)) !== null) {
      const isPublic = content[match.index + match[0].indexOf(match[1]) + match[1].length] === '*';
      exports.push({
        name: match[1],
        type: 'proc',
        public: isPublic,
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // func definitions
    const funcPattern = /func\s+(\w+)\*?\s*(?:\[|[(\s=])/g;
    while ((match = funcPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'func', line: content.slice(0, match.index).split('\n').length });
    }

    // type definitions
    const typePattern = /type\s*\n((?:\s+\w+\*?\s*=\s*[^\n]+\n?)+)/g;
    while ((match = typePattern.exec(content)) !== null) {
      const typeBlock = match[1];
      const typeNamePattern = /(\w+)\*?\s*=/g;
      let typeMatch;
      while ((typeMatch = typeNamePattern.exec(typeBlock)) !== null) {
        exports.push({ name: typeMatch[1], type: 'type', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // template definitions
    const templatePattern = /template\s+(\w+)\*?\s*(?:\[|[(\s:])/g;
    while ((match = templatePattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'template', line: content.slice(0, match.index).split('\n').length });
    }

    // macro definitions
    const macroPattern = /macro\s+(\w+)\*?\s*(?:\[|[(\s:])/g;
    while ((match = macroPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'macro', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const isTest = /import\s+unittest|suite\s+"/.test(content);
    const isNimble = filePath.endsWith('.nimble');
    const hasMain = /when\s+isMainModule/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'nim-regex',
        isTest,
        isNimble,
        hasMain
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
