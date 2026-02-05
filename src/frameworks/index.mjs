// src/frameworks/index.mjs
// Detects which frameworks a project uses and provides
// entry point patterns and annotations for dead code analysis.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getAllFrameworks } from '../knowledge/loader.mjs';

/**
 * Detect which frameworks are used in a project.
 * Checks package.json, build files, config files, go.mod, and requirements.
 */
export function detectFrameworks(projectPath) {
  const frameworks = getAllFrameworks();
  const detected = new Set();

  // Pre-read project files once
  const pkgJson = readJson(join(projectPath, 'package.json'));
  const allDeps = pkgJson
    ? { ...pkgJson.dependencies, ...pkgJson.devDependencies }
    : null;
  const pomXml = readText(join(projectPath, 'pom.xml'));
  const buildGradle = readText(join(projectPath, 'build.gradle'))
    || readText(join(projectPath, 'build.gradle.kts'));
  const goMod = readText(join(projectPath, 'go.mod'));
  const requirements = readText(join(projectPath, 'requirements.txt'))
    || readText(join(projectPath, 'requirements.in'))
    || readText(join(projectPath, 'setup.py'))
    || readText(join(projectPath, 'pyproject.toml'));

  for (const [name, fw] of Object.entries(frameworks)) {
    const detection = fw.detection;
    if (!detection) continue;

    // 1. Check package.json dependencies
    if (detection.dependencies && allDeps) {
      if (detection.dependencies.some(dep => dep in allDeps)) {
        detected.add(name);
        continue;
      }
    }

    // 2. Check config/marker files
    if (detection.files) {
      if (detection.files.some(f => existsSync(join(projectPath, f)))) {
        detected.add(name);
        continue;
      }
    }

    // 3. Check build files (pom.xml / build.gradle keywords)
    if (detection.build_files) {
      for (const descriptor of detection.build_files) {
        const lower = descriptor.toLowerCase();
        if (lower.includes('pom.xml') && pomXml) {
          const keyword = extractKeyword(descriptor);
          if (keyword && pomXml.toLowerCase().includes(keyword)) {
            detected.add(name);
            break;
          }
        }
        if (lower.includes('build.gradle') && buildGradle) {
          const keyword = extractKeyword(descriptor);
          if (keyword && buildGradle.toLowerCase().includes(keyword)) {
            detected.add(name);
            break;
          }
        }
      }
      if (detected.has(name)) continue;
    }

    // 4. Check Go imports in go.mod
    if (detection.go_imports && goMod) {
      if (detection.go_imports.some(imp => goMod.includes(imp))) {
        detected.add(name);
        continue;
      }
    }

    // 5. Check Python requirements
    if (detection.dependencies && requirements && !allDeps) {
      if (detection.dependencies.some(dep => matchesPythonDependency(requirements, dep))) {
        detected.add(name);
      }
    }
  }

  return detected;
}

/**
 * Get additional entry point glob patterns for the detected frameworks.
 */
export function getFrameworkEntryPatterns(detectedFrameworks) {
  const frameworks = getAllFrameworks();
  const patterns = [];

  for (const name of detectedFrameworks) {
    const fw = frameworks[name];
    if (!fw) continue;
    if (fw.entry_patterns) patterns.push(...fw.entry_patterns);
    if (fw.special_files) patterns.push(...fw.special_files);
  }

  return patterns;
}

/**
 * Get annotation names that mark entry points for the detected frameworks.
 */
export function getFrameworkEntryAnnotations(detectedFrameworks) {
  const frameworks = getAllFrameworks();
  const annotations = [];

  for (const name of detectedFrameworks) {
    const fw = frameworks[name];
    if (!fw) continue;
    if (fw.entry_annotations) annotations.push(...fw.entry_annotations);
    if (fw.di_decorators) annotations.push(...fw.di_decorators);
  }

  return annotations;
}

/**
 * Check if a file path matches any framework-specific entry pattern.
 * @param {string} filePath - relative path from project root
 * @param {Set<string>} detectedFrameworks
 * @returns {boolean}
 */
export function checkFrameworkEntry(filePath, detectedFrameworks) {
  const patterns = getFrameworkEntryPatterns(detectedFrameworks);
  if (patterns.length === 0) return false;

  const normalised = filePath.replace(/\\/g, '/');

  for (const pattern of patterns) {
    const regex = globToRegex(pattern);
    if (regex.test(normalised)) return true;
  }

  return false;
}

// ── helpers ──────────────────────────────────────────────────

/**
 * Check if a Python dependency name appears as an actual dependency in a requirements file.
 * Avoids substring false positives like "express" matching "consider-ternary-expression".
 * Handles requirements.txt (dep at start of line), pyproject.toml/setup.py (dep in quotes).
 */
function matchesPythonDependency(text, dep) {
  const escaped = dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // requirements.txt: dep at start of line, followed by version specifier or EOL
  const reqTxtPattern = new RegExp(`^${escaped}\\s*([>=<!~\\[;]|$)`, 'im');
  // pyproject.toml / setup.py: dep after opening quote, followed by version specifier or closing quote
  const tomlPattern = new RegExp(`['"]${escaped}\\s*([>=<!~\\[;'"]|$)`, 'im');
  return reqTxtPattern.test(text) || tomlPattern.test(text);
}

/** Extract the keyword after "with" in a build_files descriptor. */
function extractKeyword(descriptor) {
  const match = descriptor.match(/with\s+(.+)$/i);
  return match ? match[1].trim().toLowerCase() : null;
}

/** Read a file as text, returning null if it doesn't exist. */
function readText(filePath) {
  try {
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
  } catch {
    return null;
  }
}

/** Read and parse a JSON file, returning null on failure. */
function readJson(filePath) {
  const text = readText(filePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports: ** (any path), * (segment wildcard), {a,b} (alternation), ? (single char)
 */
function globToRegex(pattern) {
  let i = 0;
  let re = '';

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches any number of path segments
        re += '.*';
        i += 2;
        // skip trailing slash after **
        if (pattern[i] === '/') i++;
      } else {
        // * matches anything except /
        re += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i++;
    } else if (ch === '{') {
      // {a,b,c} alternation
      const close = pattern.indexOf('}', i);
      if (close === -1) {
        re += '\\{';
        i++;
      } else {
        const alternatives = pattern.slice(i + 1, close).split(',');
        re += '(' + alternatives.map(escapeRegex).join('|') + ')';
        i = close + 1;
      }
    } else if (ch === '.') {
      re += '\\.';
      i++;
    } else {
      re += ch;
      i++;
    }
  }

  return new RegExp('^(' + re + ')$');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
