// src/languages/shell.mjs
// Shell script parser for source, ., function declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // source or . commands (sourcing other scripts)
    const sourcePattern = /(?:source|\.)\s+["']?([^"'\s;#]+)["']?/g;
    let match;
    while ((match = sourcePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'source',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Function definitions: function name() or name()
    const funcPattern = /(?:function\s+)?(\w+)\s*\(\s*\)\s*\{/g;
    while ((match = funcPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'function',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Exported variables
    const exportPattern = /export\s+(\w+)=/g;
    while ((match = exportPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'export variable',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Alias definitions
    const aliasPattern = /alias\s+(\w+)=/g;
    while ((match = aliasPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'alias',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Detect patterns
    const isBash = /^#!.*bash|^#!.*\/sh\b/.test(content) || filePath.endsWith('.bash');
    const isZsh = /^#!.*zsh/.test(content) || filePath.endsWith('.zsh');
    const isFish = filePath.endsWith('.fish');
    const hasShebang = /^#!/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'shell-regex',
        isBash,
        isZsh,
        isFish,
        hasShebang
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
