// src/languages/cobol.mjs
// COBOL parser for COPY, CALL, PROGRAM-ID declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // Normalize to uppercase for COBOL
    const upperContent = content.toUpperCase();

    // PROGRAM-ID declaration
    const programIdPattern = /PROGRAM-ID\.\s*(\w+)/i;
    const programMatch = content.match(programIdPattern);
    const programName = programMatch ? programMatch[1] : null;
    if (programName) {
      exports.push({ name: programName, type: 'program', line: 1 });
    }

    // COPY statements (copybooks)
    const copyPattern = /COPY\s+(\w+)/gi;
    let match;
    while ((match = copyPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'copy',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // CALL statements (calling other programs)
    const callPattern = /CALL\s+["'](\w+)["']/gi;
    while ((match = callPattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'call',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // SECTION declarations
    const sectionPattern = /(\w+)\s+SECTION\./gi;
    while ((match = sectionPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'section',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // PARAGRAPH declarations (labels followed by period)
    const paragraphPattern = /^[\s0-9]{6}\s+(\w[\w-]*)\.\s*$/gm;
    while ((match = paragraphPattern.exec(content)) !== null) {
      const name = match[1];
      if (!['DIVISION', 'SECTION', 'CONFIGURATION', 'DATA', 'PROCEDURE', 'ENVIRONMENT', 'IDENTIFICATION', 'WORKING-STORAGE'].includes(name.toUpperCase())) {
        exports.push({
          name,
          type: 'paragraph',
          line: content.slice(0, match.index).split('\n').length
        });
      }
    }

    // Detect patterns
    const hasCICS = /EXEC\s+CICS/i.test(content);
    const hasSQL = /EXEC\s+SQL/i.test(content);
    const isCopybook = /\.cpy$/i.test(filePath) || /\.cob$/i.test(filePath);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'cobol-regex',
        programName,
        hasCICS,
        hasSQL,
        isCopybook
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
