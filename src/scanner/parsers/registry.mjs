// src/scanner/parsers/registry.mjs
// Multi-language parser registry with lazy loading

import { extname } from 'path';

/**
 * Parser result structure (common across all languages)
 * @typedef {Object} ParseResult
 * @property {Object} file - File info (path, relativePath)
 * @property {string} content - File content
 * @property {Array} functions - Detected functions/methods
 * @property {Array} classes - Detected classes/types
 * @property {Array} exports - Detected exports
 * @property {Array} imports - Detected imports/dependencies
 * @property {Array} annotations - Detected annotations/decorators
 * @property {number} lines - Line count
 * @property {number} size - Byte size
 * @property {string} parseMethod - Parser used
 * @property {string} [error] - Error message if parsing failed
 */

/**
 * Parser registry with lazy loading
 * Each parser is loaded on-demand to reduce startup time
 */
const parserRegistry = {
  // JavaScript/TypeScript (primary, always loaded)
  '.js': () => import('./javascript.mjs'),
  '.mjs': () => import('./javascript.mjs'),
  '.cjs': () => import('./javascript.mjs'),
  '.jsx': () => import('./javascript.mjs'),
  '.ts': () => import('./javascript.mjs'),
  '.tsx': () => import('./javascript.mjs'),
  '.vue': () => import('./javascript.mjs'),
  '.svelte': () => import('./javascript.mjs'),

  // Java/Kotlin (JVM)
  '.java': () => import('./java.mjs'),
  '.kt': () => import('./kotlin.mjs'),
  '.kts': () => import('./kotlin.mjs'),

  // .NET
  '.cs': () => import('./csharp.mjs'),
  '.fs': () => import('./fsharp.mjs'),
  '.vb': () => import('./vbnet.mjs'),

  // Python
  '.py': () => import('./python.mjs'),
  '.pyi': () => import('./python.mjs'),

  // Go
  '.go': () => import('./go.mjs'),

  // Rust
  '.rs': () => import('./rust.mjs'),

  // PHP
  '.php': () => import('./php.mjs'),

  // Ruby
  '.rb': () => import('./ruby.mjs'),

  // Swift
  '.swift': () => import('./swift.mjs'),

  // Dart
  '.dart': () => import('./dart.mjs'),

  // Scala
  '.scala': () => import('./scala.mjs'),
  '.sc': () => import('./scala.mjs'),

  // Elixir
  '.ex': () => import('./elixir.mjs'),
  '.exs': () => import('./elixir.mjs'),

  // Haskell
  '.hs': () => import('./haskell.mjs'),
  '.lhs': () => import('./haskell.mjs'),

  // OCaml
  '.ml': () => import('./ocaml.mjs'),
  '.mli': () => import('./ocaml.mjs'),

  // Julia
  '.jl': () => import('./julia.mjs'),

  // Zig
  '.zig': () => import('./zig.mjs'),

  // Nim
  '.nim': () => import('./nim.mjs'),

  // Erlang
  '.erl': () => import('./erlang.mjs'),
  '.hrl': () => import('./erlang.mjs'),

  // Crystal
  '.cr': () => import('./crystal.mjs'),

  // V
  '.v': () => import('./v.mjs'),

  // Perl
  '.pl': () => import('./perl.mjs'),
  '.pm': () => import('./perl.mjs'),

  // Clojure
  '.clj': () => import('./clojure.mjs'),
  '.cljs': () => import('./clojure.mjs'),
  '.cljc': () => import('./clojure.mjs')
};

// Cache for loaded parsers
const loadedParsers = new Map();

/**
 * Get the appropriate parser for a file extension
 * @param {string} extension - File extension (with dot, e.g., '.java')
 * @returns {Promise<Object|null>} - Parser module or null if not supported
 */
export async function getParser(extension) {
  const normalizedExt = extension.toLowerCase();
  const loader = parserRegistry[normalizedExt];

  if (!loader) {
    return null;
  }

  // Check cache
  if (loadedParsers.has(normalizedExt)) {
    return loadedParsers.get(normalizedExt);
  }

  // Load parser
  try {
    const module = await loader();
    const parser = module.default || module;
    loadedParsers.set(normalizedExt, parser);
    return parser;
  } catch (error) {
    // Parser not implemented yet - return null
    console.warn(`[ParserRegistry] Failed to load parser for ${extension}: ${error.message}`);
    return null;
  }
}

/**
 * Check if a file extension is supported
 * @param {string} extension - File extension (with dot)
 * @returns {boolean} - True if supported
 */
export function isSupported(extension) {
  return extension.toLowerCase() in parserRegistry;
}

/**
 * Get all supported extensions
 * @returns {string[]} - Array of supported extensions
 */
export function getSupportedExtensions() {
  return Object.keys(parserRegistry);
}

/**
 * Parse a file using the appropriate parser
 * @param {Object|string} file - File object with path/relativePath or just path string
 * @param {Object} options - Parser options
 * @returns {Promise<ParseResult|null>} - Parse result or null if unsupported
 */
export async function parseFile(file, options = {}) {
  const filePath = typeof file === 'string' ? file : (file.path || file.relativePath);
  const extension = extname(filePath);

  const parser = await getParser(extension);
  if (!parser) {
    return null;
  }

  // Find the parse function
  const parseFn = parser.parse || parser.parseFile || parser.parseJavaScript || parser.default;
  if (typeof parseFn !== 'function') {
    console.warn(`[ParserRegistry] No parse function found for ${extension}`);
    return null;
  }

  try {
    return await parseFn(file, options);
  } catch (error) {
    return {
      file: { path: filePath, relativePath: filePath },
      content: '',
      functions: [],
      classes: [],
      exports: [],
      imports: [],
      annotations: [],
      lines: 0,
      size: 0,
      parseMethod: 'error',
      error: error.message
    };
  }
}

/**
 * Parse multiple files in parallel
 * @param {Array<Object|string>} files - Array of file objects or paths
 * @param {Object} options - Parser options
 * @param {number} [options.concurrency=10] - Max concurrent parses
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<ParseResult[]>} - Array of parse results
 */
export async function parseFiles(files, options = {}) {
  const { concurrency = 10, onProgress } = options;
  const results = [];
  const total = files.length;

  // Process in batches
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(file => parseFile(file, options))
    );

    results.push(...batchResults.filter(r => r !== null));

    if (onProgress) {
      onProgress({ current: Math.min(i + concurrency, total), total });
    }
  }

  return results;
}

/**
 * Get language info for a file extension
 * @param {string} extension - File extension
 * @returns {Object} - Language info
 */
export function getLanguageInfo(extension) {
  const ext = extension.toLowerCase();
  const languageMap = {
    '.js': { name: 'JavaScript', family: 'js' },
    '.mjs': { name: 'JavaScript', family: 'js' },
    '.cjs': { name: 'JavaScript', family: 'js' },
    '.jsx': { name: 'JSX', family: 'js' },
    '.ts': { name: 'TypeScript', family: 'js' },
    '.tsx': { name: 'TSX', family: 'js' },
    '.vue': { name: 'Vue', family: 'js' },
    '.svelte': { name: 'Svelte', family: 'js' },
    '.java': { name: 'Java', family: 'jvm' },
    '.kt': { name: 'Kotlin', family: 'jvm' },
    '.kts': { name: 'Kotlin Script', family: 'jvm' },
    '.scala': { name: 'Scala', family: 'jvm' },
    '.cs': { name: 'C#', family: 'dotnet' },
    '.fs': { name: 'F#', family: 'dotnet' },
    '.vb': { name: 'Visual Basic', family: 'dotnet' },
    '.py': { name: 'Python', family: 'python' },
    '.pyi': { name: 'Python Stub', family: 'python' },
    '.go': { name: 'Go', family: 'go' },
    '.rs': { name: 'Rust', family: 'rust' },
    '.rb': { name: 'Ruby', family: 'ruby' },
    '.php': { name: 'PHP', family: 'php' },
    '.swift': { name: 'Swift', family: 'swift' },
    '.dart': { name: 'Dart', family: 'dart' },
    '.ex': { name: 'Elixir', family: 'elixir' },
    '.exs': { name: 'Elixir', family: 'elixir' },
    '.hs': { name: 'Haskell', family: 'haskell' },
    '.lhs': { name: 'Haskell', family: 'haskell' },
    '.ml': { name: 'OCaml', family: 'ocaml' },
    '.mli': { name: 'OCaml', family: 'ocaml' },
    '.jl': { name: 'Julia', family: 'julia' },
    '.zig': { name: 'Zig', family: 'zig' },
    '.nim': { name: 'Nim', family: 'nim' },
    '.erl': { name: 'Erlang', family: 'erlang' },
    '.hrl': { name: 'Erlang', family: 'erlang' },
    '.cr': { name: 'Crystal', family: 'crystal' },
    '.v': { name: 'V', family: 'v' },
    '.pl': { name: 'Perl', family: 'perl' },
    '.pm': { name: 'Perl', family: 'perl' },
    '.clj': { name: 'Clojure', family: 'clojure' },
    '.cljs': { name: 'Clojure', family: 'clojure' },
    '.cljc': { name: 'Clojure', family: 'clojure' },
    '.fs': { name: 'F#', family: 'dotnet' },
    '.vb': { name: 'VB.NET', family: 'dotnet' }
  };

  return languageMap[ext] || { name: 'Unknown', family: 'unknown' };
}

export default {
  getParser,
  isSupported,
  getSupportedExtensions,
  parseFile,
  parseFiles,
  getLanguageInfo
};
