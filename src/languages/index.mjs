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
  // Java/Kotlin
  '.java': 'java', '.kt': 'java', '.kts': 'java'
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
    unknown: []
  };

  for (const file of files) {
    const lang = detectLanguage(file);
    if (lang) {
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
