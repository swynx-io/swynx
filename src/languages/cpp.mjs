// src/languages/cpp.mjs
// C/C++ parser for #include, class, namespace, function declarations

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  try {
    const imports = [];
    const exports = [];

    // #include statements
    const includePattern = /#include\s*[<"]([^>"]+)[>"]/g;
    let match;
    while ((match = includePattern.exec(content)) !== null) {
      const isSystem = content[match.index + 8] === '<';
      imports.push({
        module: match[1],
        type: isSystem ? 'system include' : 'local include',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Namespace declarations
    const namespacePattern = /namespace\s+(\w+)\s*\{/g;
    while ((match = namespacePattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'namespace', line: content.slice(0, match.index).split('\n').length });
    }

    // Class declarations
    const classPattern = /(?:class|struct)\s+(?:__declspec\([^)]+\)\s+)?(\w+)(?:\s*:\s*(?:public|private|protected)\s+\w+)?(?:\s*\{|;)/g;
    while ((match = classPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'class', line: content.slice(0, match.index).split('\n').length });
    }

    // Template class declarations
    const templateClassPattern = /template\s*<[^>]+>\s*(?:class|struct)\s+(\w+)/g;
    while ((match = templateClassPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'template class', line: content.slice(0, match.index).split('\n').length });
    }

    // Function declarations (simplified - top level only)
    const funcPattern = /^(?:(?:static|inline|virtual|extern|const|constexpr|[\w:*&<>,\s]+)\s+)?(\w+)\s*\([^)]*\)\s*(?:const|noexcept|override|final|\s)*(?:\{|;)/gm;
    while ((match = funcPattern.exec(content)) !== null) {
      const name = match[1];
      if (!['if', 'while', 'for', 'switch', 'catch', 'return', 'sizeof', 'typeof', 'decltype'].includes(name)) {
        exports.push({ name, type: 'function', line: content.slice(0, match.index).split('\n').length });
      }
    }

    // Typedef declarations
    const typedefPattern = /typedef\s+(?:[^;]+\s+)?(\w+)\s*;/g;
    while ((match = typedefPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'typedef', line: content.slice(0, match.index).split('\n').length });
    }

    // Using declarations (C++11+)
    const usingPattern = /using\s+(\w+)\s*=/g;
    while ((match = usingPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'using', line: content.slice(0, match.index).split('\n').length });
    }

    // Enum declarations
    const enumPattern = /enum\s+(?:class\s+)?(\w+)/g;
    while ((match = enumPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'enum', line: content.slice(0, match.index).split('\n').length });
    }

    // Detect patterns
    const hasMainFunction = /int\s+main\s*\(/.test(content);
    const isHeader = /\.(h|hpp|hxx|h\+\+)$/i.test(filePath);
    const isTest = /#include\s*[<"](?:gtest|catch2|doctest|boost\/test)/.test(content);
    const isQt = /#include\s*<Q\w+>|Q_OBJECT/.test(content);

    return {
      imports,
      exports,
      annotations: [],
      metadata: {
        parseMethod: 'cpp-regex',
        hasMainFunction,
        isHeader,
        isTest,
        isQt
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
