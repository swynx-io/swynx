// src/languages/index.mjs
// Language detection and routing

import { getLanguagePatterns } from '../knowledge/loader.mjs';

const EXTENSION_MAP = {
  // JavaScript/TypeScript
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.jsx': 'javascript', '.ts': 'javascript', '.tsx': 'javascript',
  '.mts': 'javascript', '.cts': 'javascript',
  // Vue SFC (parsed as JavaScript via script block extraction)
  '.vue': 'javascript',
  // Python
  '.py': 'python', '.pyi': 'python',
  // Go
  '.go': 'go',
  // Java
  '.java': 'java',
  // Kotlin (separate handler)
  '.kt': 'kotlin', '.kts': 'kotlin',
  // PHP
  '.php': 'php', '.phtml': 'php', '.php3': 'php', '.php4': 'php', '.php5': 'php', '.phps': 'php',
  // Ruby
  '.rb': 'ruby', '.rake': 'ruby', '.gemspec': 'ruby', '.ru': 'ruby',
  // Rust
  '.rs': 'rust',
  // C#
  '.cs': 'csharp',
  // Dart
  '.dart': 'dart',
  // Swift
  '.swift': 'swift',
  // Scala
  '.scala': 'scala', '.sc': 'scala',
  // Elixir
  '.ex': 'elixir', '.exs': 'elixir',
  // Haskell
  '.hs': 'haskell', '.lhs': 'haskell',
  // Lua
  '.lua': 'lua',
  // C/C++
  '.c': 'cpp', '.h': 'cpp', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp', '.hh': 'cpp',
  '.cxx': 'cpp', '.hxx': 'cpp', '.c++': 'cpp', '.h++': 'cpp',
  // Perl
  '.pl': 'perl', '.pm': 'perl', '.t': 'perl',
  // R
  '.r': 'r', '.R': 'r', '.Rmd': 'r',
  // Clojure
  '.clj': 'clojure', '.cljs': 'clojure', '.cljc': 'clojure', '.edn': 'clojure',
  // F#
  '.fs': 'fsharp', '.fsi': 'fsharp', '.fsx': 'fsharp',
  // OCaml
  '.ml': 'ocaml', '.mli': 'ocaml',
  // Julia
  '.jl': 'julia',
  // Zig
  '.zig': 'zig',
  // Nim
  '.nim': 'nim', '.nims': 'nim', '.nimble': 'nim',
  // Erlang
  '.erl': 'erlang', '.hrl': 'erlang',
  // Groovy
  '.groovy': 'groovy', '.gradle': 'groovy', '.gvy': 'groovy',
  // Crystal
  '.cr': 'crystal',
  // V
  '.v': 'v', '.vv': 'v',
  // Objective-C
  '.m': 'objc', '.mm': 'objc',
  // Shell
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.fish': 'shell',
  // PowerShell
  '.ps1': 'powershell', '.psm1': 'powershell', '.psd1': 'powershell',
  // COBOL
  '.cob': 'cobol', '.cbl': 'cobol', '.cpy': 'cobol',
  // Fortran
  '.f': 'fortran', '.f90': 'fortran', '.f95': 'fortran', '.f03': 'fortran',
  '.f08': 'fortran', '.for': 'fortran', '.ftn': 'fortran',
  // VB.NET
  '.vb': 'vbnet'
};

const CODE_EXTENSIONS = new Set(Object.keys(EXTENSION_MAP));

export function detectLanguage(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return EXTENSION_MAP[ext] || null;
}

export function isCodeFile(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return CODE_EXTENSIONS.has(ext);
}

export function groupFilesByLanguage(files) {
  const groups = {
    javascript: [],
    python: [],
    go: [],
    java: [],
    kotlin: [],
    php: [],
    ruby: [],
    rust: [],
    csharp: [],
    dart: [],
    swift: [],
    scala: [],
    elixir: [],
    haskell: [],
    lua: [],
    cpp: [],
    perl: [],
    r: [],
    clojure: [],
    fsharp: [],
    ocaml: [],
    julia: [],
    zig: [],
    nim: [],
    erlang: [],
    groovy: [],
    crystal: [],
    v: [],
    objc: [],
    shell: [],
    powershell: [],
    cobol: [],
    fortran: [],
    vbnet: [],
    unknown: []
  };

  for (const file of files) {
    const lang = detectLanguage(file);
    if (lang && groups[lang]) {
      groups[lang].push(file);
    } else {
      groups.unknown.push(file);
    }
  }

  return groups;
}

// Dynamic handler loading
const handlers = {};

export async function getLanguageHandler(language) {
  if (!handlers[language]) {
    switch (language) {
      case 'javascript':
        handlers[language] = await import('./javascript.mjs');
        break;
      case 'python':
        handlers[language] = await import('./python.mjs');
        break;
      case 'go':
        handlers[language] = await import('./go.mjs');
        break;
      case 'java':
        handlers[language] = await import('./java.mjs');
        break;
      case 'kotlin':
        handlers[language] = await import('./kotlin.mjs');
        break;
      case 'php':
        handlers[language] = await import('./php.mjs');
        break;
      case 'ruby':
        handlers[language] = await import('./ruby.mjs');
        break;
      case 'rust':
        handlers[language] = await import('./rust.mjs');
        break;
      case 'csharp':
        handlers[language] = await import('./csharp.mjs');
        break;
      case 'dart':
        handlers[language] = await import('./dart.mjs');
        break;
      case 'swift':
        handlers[language] = await import('./swift.mjs');
        break;
      case 'scala':
        handlers[language] = await import('./scala.mjs');
        break;
      case 'elixir':
        handlers[language] = await import('./elixir.mjs');
        break;
      case 'haskell':
        handlers[language] = await import('./haskell.mjs');
        break;
      case 'lua':
        handlers[language] = await import('./lua.mjs');
        break;
      case 'cpp':
        handlers[language] = await import('./cpp.mjs');
        break;
      case 'perl':
        handlers[language] = await import('./perl.mjs');
        break;
      case 'r':
        handlers[language] = await import('./r.mjs');
        break;
      case 'clojure':
        handlers[language] = await import('./clojure.mjs');
        break;
      case 'fsharp':
        handlers[language] = await import('./fsharp.mjs');
        break;
      case 'ocaml':
        handlers[language] = await import('./ocaml.mjs');
        break;
      case 'julia':
        handlers[language] = await import('./julia.mjs');
        break;
      case 'zig':
        handlers[language] = await import('./zig.mjs');
        break;
      case 'nim':
        handlers[language] = await import('./nim.mjs');
        break;
      case 'erlang':
        handlers[language] = await import('./erlang.mjs');
        break;
      case 'groovy':
        handlers[language] = await import('./groovy.mjs');
        break;
      case 'crystal':
        handlers[language] = await import('./crystal.mjs');
        break;
      case 'v':
        handlers[language] = await import('./v.mjs');
        break;
      case 'objc':
        handlers[language] = await import('./objc.mjs');
        break;
      case 'shell':
        handlers[language] = await import('./shell.mjs');
        break;
      case 'powershell':
        handlers[language] = await import('./powershell.mjs');
        break;
      case 'cobol':
        handlers[language] = await import('./cobol.mjs');
        break;
      case 'fortran':
        handlers[language] = await import('./fortran.mjs');
        break;
      case 'vbnet':
        handlers[language] = await import('./vbnet.mjs');
        break;
      default:
        return null;
    }

    // Initialize handler with its patterns
    const patterns = getLanguagePatterns(language);
    if (handlers[language].initialize && patterns) {
      await handlers[language].initialize(patterns);
    }
  }

  return handlers[language];
}

export async function parseFile(filePath, content) {
  const language = detectLanguage(filePath);
  if (!language) return null;

  const handler = await getLanguageHandler(language);
  if (!handler) return null;

  return handler.parse(filePath, content);
}
