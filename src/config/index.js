import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { pathToFileURL } from 'url';
import { defaults } from './defaults.js';

let config = null;

export async function loadConfig(configPath = null, projectPath = null) {
  // Start with defaults
  config = JSON.parse(JSON.stringify(defaults));

  // Set project root if provided
  if (projectPath) {
    config.project.root = resolve(projectPath);
  }

  // Try to load config file
  const paths = configPath
    ? [configPath]
    : [
        './swynx.config.js',
        './swynx.config.json',
        projectPath ? resolve(projectPath, 'swynx.config.js') : null,
        projectPath ? resolve(projectPath, 'swynx.config.json') : null,
        './peer-audit.config.js',
        './peer-audit.config.json',
        projectPath ? resolve(projectPath, 'peer-audit.config.js') : null,
        projectPath ? resolve(projectPath, 'peer-audit.config.json') : null
      ].filter(Boolean);

  for (const path of paths) {
    const fullPath = resolve(path);
    if (existsSync(fullPath)) {
      try {
        let fileConfig;
        if (path.endsWith('.js')) {
          // Dynamic import for JS config
          const configModule = await import(pathToFileURL(fullPath).href);
          fileConfig = configModule.default || configModule;
        } else {
          // JSON config
          fileConfig = JSON.parse(readFileSync(fullPath, 'utf-8'));
        }
        config = deepMerge(config, fileConfig);
        config._loadedFrom = fullPath;
        break;
      } catch (err) {
        // Skip invalid config files
        console.error(`Warning: Could not load config from ${path}:`, err.message);
      }
    }
  }

  return config;
}

export function getConfig() {
  if (!config) {
    // Return defaults if not loaded yet
    return JSON.parse(JSON.stringify(defaults));
  }
  return config;
}

export function setConfig(newConfig) {
  config = deepMerge(config || defaults, newConfig);
  return config;
}

function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

export function resolveProjectPath(projectPath, subPath) {
  return resolve(projectPath, subPath);
}
