// src/languages/fortran.mjs
// Fortran parser for use, module, subroutine, function declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // MODULE declaration
    const modulePattern = /^\s*module\s+(\w+)/gim;
    let match;
    while ((match = modulePattern.exec(content)) !== null) {
      const name = match[1];
      if (name.toLowerCase() !== 'procedure') {
        exports.push({
          name,
          type: 'module',
          line: content.slice(0, match.index).split('\n').length
        });
      }
    }

    // USE statements
    const usePattern = /^\s*use\s+(\w+)(?:\s*,\s*only\s*:\s*([^!&\n]+))?/gim;
    while ((match = usePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        only: match[2] ? match[2].split(',').map(s => s.trim()) : null,
        type: 'use',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // INCLUDE statements
    const includePattern = /^\s*include\s+["']([^"']+)["']/gim;
    while ((match = includePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'include',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // PROGRAM declaration
    const programPattern = /^\s*program\s+(\w+)/gim;
    while ((match = programPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'program',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // SUBROUTINE declarations
    const subroutinePattern = /^\s*(?:recursive\s+)?subroutine\s+(\w+)/gim;
    while ((match = subroutinePattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'subroutine',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // FUNCTION declarations
    const functionPattern = /^\s*(?:(?:integer|real|double\s+precision|complex|logical|character)(?:\s*\*\s*\d+)?\s+)?function\s+(\w+)/gim;
    while ((match = functionPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'function',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // TYPE definitions
    const typePattern = /^\s*type(?:\s*,\s*\w+)*\s*::\s*(\w+)/gim;
    while ((match = typePattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'type',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Interface blocks
    const interfacePattern = /^\s*interface\s+(\w+)/gim;
    while ((match = interfacePattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'interface',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Detect patterns
    const hasOpenMP = /!\$omp/i.test(content);
    const hasMPI = /use\s+mpi|include\s+['"]mpif\.h["']/i.test(content);
    const isFortran90Plus = /^\s*module\s+/im.test(content) || /^\s*use\s+/im.test(content);
    const isFreeForm = !/^.{6}/m.test(content) || /\.f90$|\.f95$|\.f03$|\.f08$/i.test(filePath);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'fortran-regex',
        hasOpenMP,
        hasMPI,
        isFortran90Plus,
        isFreeForm
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
