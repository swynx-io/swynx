// src/languages/perl.mjs
// Perl parser for use, require, package declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // Package declaration
    const packageMatch = content.match(/package\s+([\w:]+)/);
    const packageName = packageMatch ? packageMatch[1] : null;
    if (packageName) {
      exports.push({ name: packageName, type: 'package', line: 1 });
    }

    // use statements
    const usePattern = /use\s+([\w:]+)(?:\s+(?:qw\([^)]+\)|[^;]+))?;/g;
    let match;
    while ((match = usePattern.exec(content)) !== null) {
      const module = match[1];
      // Skip pragmas
      if (!['strict', 'warnings', 'utf8', 'vars', 'constant', 'lib', 'base', 'parent', 'feature', 'experimental'].includes(module)) {
        imports.push({
          module,
          type: 'use',
          line: content.slice(0, match.index).split('\n').length
        });
      }
    }

    // require statements
    const requirePattern = /require\s+([\w:]+|["'][^"']+["']);/g;
    while ((match = requirePattern.exec(content)) !== null) {
      imports.push({
        module: match[1].replace(/["']/g, ''),
        type: 'require',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Subroutine definitions
    const subPattern = /sub\s+(\w+)\s*(?:\([^)]*\))?\s*\{/g;
    while ((match = subPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'sub', line: content.slice(0, match.index).split('\n').length });
    }

    // Moose/Moo attribute definitions
    const hasPattern = /has\s+['"]?(\w+)['"]?\s*=>/g;
    while ((match = hasPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'attribute', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const isMoose = /use\s+Moose|use\s+Moo(?:se)?/.test(content);
    const isTest = /use\s+Test::/.test(content);
    const isCGI = /use\s+CGI/.test(content);
    const isDancer = /use\s+Dancer/.test(content);
    const isCatalyst = /use\s+Catalyst/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'perl-regex',
        packageName,
        isMoose,
        isTest,
        isCGI,
        isDancer,
        isCatalyst
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
