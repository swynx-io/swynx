// src/languages/java.mjs
// Java/Kotlin parser with Spring, Quarkus, Jakarta annotation support
// Extracted from swynx/src/scanner/parsers/java.mjs
// Represents 15+ hours of validated detection logic

let languagePatterns = null;

export function initialize(patterns) {
  languagePatterns = patterns;
}

export function parse(filePath, content) {
  if (!content) return createEmptyResult(filePath);

  const isKotlin = filePath.endsWith('.kt') || filePath.endsWith('.kts');

  try {
    const lines = content.split('\n');
    const functions = [];
    const classes = [];
    const annotations = [];
    const imports = [];
    let packageName = null;

    // Package declaration
    const packageMatch = content.match(/^\s*package\s+([\w.]+)\s*;?/m);
    if (packageMatch) {
      packageName = packageMatch[1];
    }

    // Extract imports
    const importPattern = /^\s*import\s+(static\s+)?([\w.*]+)\s*;?/gm;
    let importMatch;
    while ((importMatch = importPattern.exec(content)) !== null) {
      const lineNum = content.substring(0, importMatch.index).split('\n').length;
      imports.push({
        module: importMatch[2],
        type: importMatch[1] ? 'static' : 'normal',
        line: lineNum
      });
    }

    // Track annotations for current element
    let pendingAnnotations = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Detect annotations
      const annotationPattern = /@(\w+)(?:\s*\(([^)]*)\))?/g;
      let annotationMatch;
      while ((annotationMatch = annotationPattern.exec(line)) !== null) {
        const annotation = {
          name: annotationMatch[1],
          args: annotationMatch[2] || null,
          line: lineNum
        };
        annotations.push(annotation);
        pendingAnnotations.push(annotation);
      }

      // Class/interface/enum/record declaration
      const classMatch = line.match(
        /^\s*(public|private|protected)?\s*(abstract|final|static)?\s*(class|interface|enum|record)\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/
      );
      if (classMatch) {
        const classInfo = {
          name: classMatch[4],
          type: classMatch[3],
          visibility: classMatch[1] || 'package-private',
          modifiers: classMatch[2] ? [classMatch[2]] : [],
          line: lineNum,
          endLine: findBlockEnd(lines, i),
          superClass: classMatch[5] || null,
          interfaces: classMatch[6] ? classMatch[6].split(',').map(s => s.trim()) : [],
          decorators: [...pendingAnnotations],
          annotations: [...pendingAnnotations],
          methods: [],
          exported: classMatch[1] === 'public'
        };

        classInfo.lineCount = classInfo.endLine - classInfo.line + 1;
        classes.push(classInfo);
        pendingAnnotations = [];
      }

      // Method declaration
      const methodMatch = line.match(
        /^\s*(public|private|protected)?\s*(static|final|abstract|synchronized|native)?\s*(?:<[\w\s,<>?]+>\s+)?(\w+(?:<[\w\s,<>?]+>)?(?:\[\])?)\s+(\w+)\s*\(([^)]*)\)/
      );
      if (methodMatch && !line.includes(' class ') && !line.includes(' interface ') && !line.includes(' new ')) {
        const methodInfo = {
          name: methodMatch[4],
          type: 'method',
          visibility: methodMatch[1] || 'package-private',
          modifiers: methodMatch[2] ? [methodMatch[2]] : [],
          returnType: methodMatch[3],
          params: parseJavaParams(methodMatch[5]),
          line: lineNum,
          endLine: findBlockEnd(lines, i),
          decorators: [...pendingAnnotations],
          annotations: [...pendingAnnotations],
          signature: `${methodMatch[3]} ${methodMatch[4]}(${methodMatch[5]})`
        };

        methodInfo.lineCount = methodInfo.endLine - methodInfo.line + 1;

        if (methodMatch[4] === 'main' && methodMatch[2] === 'static' && methodMatch[1] === 'public') {
          methodInfo.isMainMethod = true;
        }

        functions.push(methodInfo);

        // Add to current class if inside one
        if (classes.length > 0) {
          const currentClass = classes[classes.length - 1];
          if (lineNum > currentClass.line && lineNum < currentClass.endLine) {
            currentClass.methods.push(methodInfo);
          }
        }

        pendingAnnotations = [];
      }

      // Clear pending annotations on non-annotation content lines
      if (line.trim() && !line.trim().startsWith('@') && !line.trim().startsWith('//') && !line.trim().startsWith('/*')) {
        if (!classMatch && !methodMatch) {
          pendingAnnotations = [];
        }
      }
    }

    // Build exports (public classes)
    const exports = classes
      .filter(c => c.exported)
      .map(c => ({ name: c.name, type: c.type, line: c.line }));

    // All entry point annotations from knowledge base
    const entryAnnotationNames = new Set();
    if (languagePatterns?.entry_point_annotations) {
      for (const group of Object.values(languagePatterns.entry_point_annotations)) {
        for (const anno of group) {
          entryAnnotationNames.add(anno.name);
        }
      }
    }

    // Determine if this is a Spring/DI component
    const isSpringComponent = annotations.some(a =>
      ['Component', 'Service', 'Repository', 'Controller', 'RestController',
       'Configuration', 'SpringBootApplication',
       'ApplicationScoped', 'RequestScoped', 'SessionScoped', 'Dependent', 'Singleton', 'Named',
       'Stateless', 'Stateful', 'MessageDriven', 'Path', 'Provider',
       'QuarkusMain', 'Entity', 'MappedSuperclass', 'Converter',
       'BuildStep', 'BuildSteps', 'Recorder'].includes(a.name)
    );

    return {
      imports,
      exports,
      classes,
      functions,
      annotations,
      metadata: {
        parseMethod: isKotlin ? 'kotlin-regex' : 'java-regex',
        packageName,
        hasMainMethod: functions.some(f => f.isMainMethod),
        isSpringComponent
      }
    };
  } catch (error) {
    return createEmptyResult(filePath, `Parse error: ${error.message}`);
  }
}

function parseJavaParams(paramsStr) {
  if (!paramsStr || !paramsStr.trim()) return [];
  const params = [];
  let depth = 0;
  let current = '';

  for (const char of paramsStr) {
    if (char === '<') depth++;
    else if (char === '>') depth--;
    else if (char === ',' && depth === 0) {
      if (current.trim()) params.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) params.push(current.trim());
  return params;
}

function findBlockEnd(lines, startIndex) {
  let braceCount = 0;
  let started = false;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    let inString = false;
    let stringChar = '';

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      const nextChar = line[j + 1];

      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        stringChar = char;
        continue;
      }
      if (inString && char === stringChar && line[j - 1] !== '\\') {
        inString = false;
        continue;
      }
      if (inString) continue;
      if (char === '/' && nextChar === '/') break;

      if (char === '{') { braceCount++; started = true; }
      else if (char === '}') {
        braceCount--;
        if (started && braceCount === 0) return i + 1;
      }
    }
  }
  return startIndex + 1;
}

function createEmptyResult(filePath, error = null) {
  return {
    imports: [], exports: [], classes: [], functions: [], annotations: [],
    metadata: { parseMethod: 'none', error }
  };
}

export default { parse, initialize };
