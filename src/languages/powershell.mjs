// src/languages/powershell.mjs
// PowerShell parser for Import-Module, function, class declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // Import-Module statements
    const importModulePattern = /Import-Module\s+(?:-Name\s+)?["']?(\w+)["']?/gi;
    let match;
    while ((match = importModulePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'Import-Module',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // using module statements
    const usingModulePattern = /using\s+module\s+["']?([^"'\s;]+)["']?/gi;
    while ((match = usingModulePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'using module',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // using namespace statements
    const usingNamespacePattern = /using\s+namespace\s+([\w.]+)/gi;
    while ((match = usingNamespacePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'using namespace',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // . sourcing (dot sourcing other scripts)
    const dotSourcePattern = /\.\s+["']?([^"'\s;]+\.ps1)["']?/g;
    while ((match = dotSourcePattern.exec(content)) !== null) {
      imports.push({
        module: match[1],
        type: 'dot source',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Function definitions
    const functionPattern = /function\s+([\w-]+)\s*(?:\([^)]*\))?\s*\{/gi;
    while ((match = functionPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'function',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Class definitions
    const classPattern = /class\s+(\w+)\s*(?::\s*\w+)?\s*\{/gi;
    while ((match = classPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'class',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Enum definitions
    const enumPattern = /enum\s+(\w+)\s*\{/gi;
    while ((match = enumPattern.exec(content)) !== null) {
      exports.push({
        name: match[1],
        type: 'enum',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Detect patterns
    const isModule = filePath.endsWith('.psm1');
    const isScript = filePath.endsWith('.ps1');
    const isManifest = filePath.endsWith('.psd1');
    const isPester = /Describe\s+["']|It\s+["']|Should\s+/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'powershell-regex',
        isModule,
        isScript,
        isManifest,
        isPester
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
