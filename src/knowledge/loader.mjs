// src/knowledge/loader.mjs
// Loads all pattern definitions at scan start

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let loadedPatterns = null;

export async function loadKnowledge() {
  if (loadedPatterns) return loadedPatterns;

  loadedPatterns = {
    languages: {},
    frameworks: {},
    patterns: {},
    learned: {}
  };

  // Load language patterns
  const langDir = join(__dirname, 'languages');
  if (existsSync(langDir)) {
    for (const file of readdirSync(langDir).filter(f => f.endsWith('.json'))) {
      const lang = file.replace('.json', '');
      try {
        loadedPatterns.languages[lang] = JSON.parse(
          readFileSync(join(langDir, file), 'utf8')
        );
      } catch (e) {
        console.warn(`[knowledge] Failed to load language pattern: ${file}`, e.message);
      }
    }
  }

  // Load framework patterns
  const fwDir = join(__dirname, 'frameworks');
  if (existsSync(fwDir)) {
    for (const file of readdirSync(fwDir).filter(f => f.endsWith('.json'))) {
      const fw = file.replace('.json', '');
      try {
        loadedPatterns.frameworks[fw] = JSON.parse(
          readFileSync(join(fwDir, file), 'utf8')
        );
      } catch (e) {
        console.warn(`[knowledge] Failed to load framework pattern: ${file}`, e.message);
      }
    }
  }

  // Load universal patterns
  const patDir = join(__dirname, 'patterns');
  if (existsSync(patDir)) {
    for (const file of readdirSync(patDir).filter(f => f.endsWith('.json'))) {
      const pat = file.replace('.json', '');
      try {
        loadedPatterns.patterns[pat] = JSON.parse(
          readFileSync(join(patDir, file), 'utf8')
        );
      } catch (e) {
        console.warn(`[knowledge] Failed to load pattern: ${file}`, e.message);
      }
    }
  }

  // Load learned patterns
  const learnedDir = join(__dirname, 'learned');
  if (existsSync(learnedDir)) {
    for (const file of readdirSync(learnedDir).filter(f => f.endsWith('.json'))) {
      const name = file.replace('.json', '');
      try {
        loadedPatterns.learned[name] = JSON.parse(
          readFileSync(join(learnedDir, file), 'utf8')
        );
      } catch (e) {
        console.warn(`[knowledge] Failed to load learned pattern: ${file}`, e.message);
      }
    }
  }

  return loadedPatterns;
}

export function getLanguagePatterns(language) {
  return loadedPatterns?.languages[language] || null;
}

export function getFrameworkPatterns(framework) {
  return loadedPatterns?.frameworks[framework] || null;
}

export function getAllFrameworks() {
  return loadedPatterns?.frameworks || {};
}

export function getAllEntryPointAnnotations(language) {
  const langPatterns = loadedPatterns?.languages[language];
  if (!langPatterns?.entry_point_annotations) return [];

  const all = [];
  for (const [framework, annotations] of Object.entries(langPatterns.entry_point_annotations)) {
    for (const anno of annotations) {
      all.push({ ...anno, framework });
    }
  }
  return all;
}

export function getImportResolutionStrategies(language) {
  const langPatterns = loadedPatterns?.languages[language];
  return langPatterns?.import_resolution?.strategies || [];
}

export function getFrameworkFilter(language) {
  const langPatterns = loadedPatterns?.languages[language];
  return langPatterns?.framework_filter?.prefixes || [];
}

export function getSamePackageLinking(language) {
  const langPatterns = loadedPatterns?.languages[language];
  return langPatterns?.same_package_linking || null;
}

export function getLearnedFalsePositives() {
  return loadedPatterns?.learned?.['false-positives']?.false_positives || [];
}

export function getLearnedPatterns() {
  return loadedPatterns?.learned?.['new-patterns']?.patterns || [];
}

export function getEntryPointFilePatterns() {
  return loadedPatterns?.patterns?.['entry-points']?.file_patterns || [];
}

export function getDIContainerPatterns() {
  return loadedPatterns?.patterns?.['entry-points']?.patterns?.di_container_references?.detect_patterns || [];
}

export function resetKnowledge() {
  loadedPatterns = null;
}
