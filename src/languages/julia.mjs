// src/languages/julia.mjs
// Julia parser for using, import, include, module declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // Module declaration
    const moduleMatch = content.match(/module\s+(\w+)/);
    const moduleName = moduleMatch ? moduleMatch[1] : null;
    if (moduleName) {
      exports.push({ name: moduleName, type: 'module', line: 1 });
    }

    // using statements
    const usingPattern = /using\s+([\w.,\s:]+)/g;
    let match;
    while ((match = usingPattern.exec(content)) !== null) {
      const modules = match[1].split(',').map(m => m.trim().split(':')[0].trim());
      for (const module of modules) {
        if (module) {
          imports.push({
            module,
            type: 'using',
            line: content.slice(0, match.index).split('\n').length
          });
        }
      }
    }

    // import statements
    const importPattern = /import\s+([\w.,\s:]+)/g;
    while ((match = importPattern.exec(content)) !== null) {
      const modules = match[1].split(',').map(m => m.trim().split(':')[0].trim());
      for (const module of modules) {
        if (module) {
          imports.push({
            module,
            type: 'import',
            line: content.slice(0, match.index).split('\n').length
          });
        }
      }
    }

    // include statements (including other Julia files)
    const includePattern = /include\s*\(\s*["']([^"']+)["']\s*\)/g;
    while ((match = includePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'include',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // export statements
    const exportPattern = /export\s+([\w,\s]+)/g;
    while ((match = exportPattern.exec(content)) !== null) {
      const names = match[1].split(',').map(n => n.trim());
      for (const name of names) {
        if (name) {
          exports.push({ name, type: 'export', line: content.slice(0, match.index).split('\n').length });
        }
      }
    }

    // Function definitions
    const funcPattern = /function\s+(\w+)/g;
    while ((match = funcPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'function', line: content.slice(0, match.index).split('\n').length });
    }

    // Short function definitions
    const shortFuncPattern = /^(\w+)\s*\([^)]*\)\s*=/gm;
    while ((match = shortFuncPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'function', line: content.slice(0, match.index).split('\n').length });
    }

    // Struct definitions
    const structPattern = /(?:mutable\s+)?struct\s+(\w+)/g;
    while ((match = structPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'struct', line: content.slice(0, match.index).split('\n').length });
    }

    // Abstract type definitions
    const abstractPattern = /abstract\s+type\s+(\w+)/g;
    while ((match = abstractPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'abstract type', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const isTest = /using\s+Test|@test\s+|@testset/.test(content);
    const isPlots = /using\s+Plots/.test(content);
    const isFlux = /using\s+Flux/.test(content);
    const isDifferentialEquations = /using\s+DifferentialEquations/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'julia-regex',
        moduleName,
        isTest,
        isPlots,
        isFlux,
        isDifferentialEquations
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
