// src/languages/r.mjs
// R parser for library, require, source declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // library() calls
    const libraryPattern = /library\s*\(\s*["']?(\w+)["']?\s*\)/g;
    let match;
    while ((match = libraryPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'library',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // require() calls
    const requirePattern = /require\s*\(\s*["']?(\w+)["']?\s*\)/g;
    while ((match = requirePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'require',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // source() calls - loading other R files
    const sourcePattern = /source\s*\(\s*["']([^"']+)["']\s*\)/g;
    while ((match = sourcePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'source',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Package namespace imports (pkg::func or pkg:::func)
    const namespacePattern = /(\w+):::\?(\w+)/g;
    while ((match = namespacePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'namespace',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Function definitions
    const funcPattern = /(\w+)\s*<-\s*function\s*\(/g;
    while ((match = funcPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'function', line: content.slice(0, match.index).split('\n').length });
    }

    // S4 class definitions
    const setClassPattern = /setClass\s*\(\s*["'](\w+)["']/g;
    while ((match = setClassPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'S4 class', line: content.slice(0, match.index).split('\n').length });
    }

    // R6 class definitions
    const r6Pattern = /(\w+)\s*<-\s*R6Class\s*\(/g;
    while ((match = r6Pattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'R6 class', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const isShiny = /library\s*\(\s*shiny\s*\)|shinyApp|shinyServer/.test(content);
    const isTest = /library\s*\(\s*testthat\s*\)|test_that\s*\(/.test(content);
    const isTidyverse = /library\s*\(\s*(?:tidyverse|dplyr|ggplot2|tidyr)\s*\)/.test(content);
    const isRMarkdown = /```\{r/.test(content) || filePath.endsWith('.Rmd');

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'r-regex',
        isShiny,
        isTest,
        isTidyverse,
        isRMarkdown
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
