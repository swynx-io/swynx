// src/languages/erlang.mjs
// Erlang parser for -module, -export, -import, -include declarations

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
    const moduleMatch = content.match(/-module\s*\(\s*(\w+)\s*\)/);
    const moduleName = moduleMatch ? moduleMatch[1] : null;
    if (moduleName) {
      exports.push({ name: moduleName, type: 'module', line: 1 });
    }

    // -include and -include_lib directives
    const includePattern = /-include(?:_lib)?\s*\(\s*"([^"]+)"\s*\)/g;
    let match;
    while ((match = includePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'include',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // -import directive
    const importPattern = /-import\s*\(\s*(\w+)\s*,\s*\[([^\]]+)\]\s*\)/g;
    while ((match = importPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'import',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // -export directive
    const exportPattern = /-export\s*\(\s*\[([^\]]+)\]\s*\)/g;
    while ((match = exportPattern.exec(content)) !== null) {
      const funcs = match[1].split(',').map(f => f.trim());
      for (const func of funcs) {
        const funcMatch = func.match(/(\w+)\s*\/\s*(\d+)/);
        if (funcMatch) {
          exports.push({
            name: funcMatch[1],
            arity: parseInt(funcMatch[2]),
            type: 'export',
            line: content.slice(0, match.index).split('\n').length
          });
        }
      }
    }

    // -behaviour/-behavior directive
    const behaviourPattern = /-behaviou?r\s*\(\s*(\w+)\s*\)/g;
    while ((match = behaviourPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'behaviour',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Function definitions
    const funcPattern = /^(\w+)\s*\([^)]*\)\s*(?:when\s+[^-]+)?->/gm;
    while ((match = funcPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'function', line: content.slice(0, match.index).split('\n').length });
    }

    // Record definitions
    const recordPattern = /-record\s*\(\s*(\w+)/g;
    while ((match = recordPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'record', line: content.slice(0, match.index).split('\n').length });
    }

    // Type definitions
    const typePattern = /-type\s+(\w+)/g;
    while ((match = typePattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'type', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const isOTP = /-behaviou?r\s*\(\s*(?:gen_server|gen_fsm|gen_statem|gen_event|supervisor|application)\s*\)/.test(content);
    const isTest = /-include_lib\s*\(\s*"eunit|_SUITE\.erl$/.test(content) || filePath.endsWith('_SUITE.erl');
    const isCowboy = /-behaviou?r\s*\(\s*cowboy_/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'erlang-regex',
        moduleName,
        isOTP,
        isTest,
        isCowboy
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
