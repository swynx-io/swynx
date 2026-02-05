// src/config/index.mjs

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, accessSync, constants, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { DEFAULT_CONFIG, DEFAULT_COSTS, DEFAULT_CI, getCurrencySymbol } from './defaults.mjs';

export { DEFAULT_CONFIG, DEFAULT_COSTS, DEFAULT_CI, getCurrencySymbol };

/**
 * Determine the data directory for Swynx.
 * Priority:
 * 1. SWYNX_DATA_DIR env var (explicit override, also supports legacy PEER_AUDIT_DATA_DIR)
 * 2. /var/lib/swynx if exists and writable (systemd/server install)
 * 3. ~/.swynx (user install, default)
 */
function getDataDir() {
  // 1. Explicit env var takes priority
  if (process.env.SWYNX_DATA_DIR || process.env.PEER_AUDIT_DATA_DIR) {
    return process.env.SWYNX_DATA_DIR || process.env.PEER_AUDIT_DATA_DIR;
  }

  // 2. If /var/lib/swynx exists and is writable, use it (systemd/server install)
  const systemDir = '/var/lib/swynx';
  if (existsSync(systemDir)) {
    try {
      accessSync(systemDir, constants.W_OK);
      return systemDir;
    } catch {
      // Not writable, fall through
    }
  }

  // 3. Default to ~/.swynx (user install)
  const home = process.env.HOME || process.env.USERPROFILE || homedir() || '/root';
  return join(home, '.swynx');
}

/**
 * The resolved data directory - use this everywhere instead of hardcoding ~/.swynx
 */
export const DATA_DIR = getDataDir();

/**
 * Ensure the data directory exists
 */
export function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
  return DATA_DIR;
}

/**
 * Deep merge two objects
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Get global config directory path
 */
function getGlobalConfigDir() {
  return DATA_DIR;
}

/**
 * Get global settings file path
 */
function getGlobalSettingsPath() {
  return join(getGlobalConfigDir(), 'settings.json');
}

/**
 * Load global configuration from ~/.swynx/settings.json
 * @param {object} options - Options
 * @param {boolean} options.quiet - Suppress warnings
 * @returns {Promise<object>} Global config or empty object
 */
export async function loadGlobalConfig(options = {}) {
  const settingsPath = getGlobalSettingsPath();

  try {
    const content = await readFile(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // No global settings file, that's fine
      return {};
    }
    // Log but don't fail - use defaults (suppress in CI mode)
    if (!options.quiet) {
      console.warn(`Warning: Could not read global config: ${error.message}`);
    }
    return {};
  }
}

/**
 * Save global configuration to ~/.swynx/settings.json
 * @param {object} config - Configuration to save
 */
export async function saveGlobalConfig(config) {
  const configDir = getGlobalConfigDir();
  const settingsPath = getGlobalSettingsPath();

  try {
    // Ensure directory exists
    await mkdir(configDir, { recursive: true });

    // Load existing config and merge
    const existing = await loadGlobalConfig();
    const merged = deepMerge(existing, config);

    await writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
    return { success: true, path: settingsPath };
  } catch (error) {
    throw new Error(`Failed to save global config: ${error.message}`);
  }
}

/**
 * Load project-specific configuration from .swynx.json
 * @param {string} projectPath - Project directory path
 * @param {object} options - Options
 * @param {boolean} options.quiet - Suppress warnings
 * @returns {Promise<object>} Project config or empty object
 */
async function loadProjectConfig(projectPath, options = {}) {
  const configPaths = [
    join(projectPath, '.swynx.json'),
    join(projectPath, 'swynx.config.json'),
    join(projectPath, '.swynxrc.json')
  ];

  for (const configPath of configPaths) {
    try {
      const content = await readFile(configPath, 'utf-8');
      return { config: JSON.parse(content), source: configPath };
    } catch (error) {
      if (error.code !== 'ENOENT' && !options.quiet) {
        console.warn(`Warning: Could not read ${configPath}: ${error.message}`);
      }
    }
  }

  // Try JS config files
  const jsConfigPaths = [
    join(projectPath, 'swynx.config.js'),
    join(projectPath, 'swynx.config.mjs'),
    join(projectPath, '.swynx.js')
  ];

  for (const configPath of jsConfigPaths) {
    try {
      const module = await import(configPath);
      return { config: module.default || module, source: configPath };
    } catch (error) {
      // Silently skip: module not found, dynamic import not supported (pkg), or any import error
      const isExpectedError =
        error.code === 'ERR_MODULE_NOT_FOUND' ||
        error.message?.includes('Cannot find module') ||
        error.message?.includes('dynamic import');

      if (!isExpectedError && !options.quiet) {
        console.warn(`Warning: Could not load ${configPath}: ${error.message}`);
      }
    }
  }

  return { config: {}, source: null };
}

/**
 * Save project configuration to .swynx.json
 * @param {string} projectPath - Project directory path
 * @param {object} config - Configuration to save
 */
export async function saveProjectConfig(projectPath, config) {
  const configPath = join(projectPath, '.swynx.json');

  try {
    // Load existing config and merge
    const { config: existing } = await loadProjectConfig(projectPath);
    const merged = deepMerge(existing, config);

    await writeFile(configPath, JSON.stringify(merged, null, 2), 'utf-8');
    return { success: true, path: configPath };
  } catch (error) {
    throw new Error(`Failed to save project config: ${error.message}`);
  }
}

/**
 * Load configuration with full hierarchy
 * Precedence: defaults < global < project < CLI flags
 *
 * @param {string|null} configPath - Optional explicit config file path
 * @param {string} projectPath - Project directory path
 * @param {object} cliOptions - CLI options to merge
 * @param {object} options - Additional options
 * @param {boolean} options.quiet - Suppress warnings (for CI mode)
 * @returns {Promise<object>} Merged configuration with _source metadata
 */
export async function loadConfig(configPath = null, projectPath = process.cwd(), cliOptions = {}, options = {}) {
  // Start with defaults
  let config = deepMerge({}, DEFAULT_CONFIG);
  const sources = ['defaults'];
  const quiet = options.quiet || false;

  // Load explicit config file if provided
  if (configPath) {
    try {
      const resolvedPath = resolve(configPath);
      if (resolvedPath.endsWith('.json')) {
        const content = await readFile(resolvedPath, 'utf-8');
        config = deepMerge(config, JSON.parse(content));
        sources.push(`file:${resolvedPath}`);
      } else {
        const module = await import(resolvedPath);
        config = deepMerge(config, module.default || module);
        sources.push(`file:${resolvedPath}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ERR_MODULE_NOT_FOUND') {
        throw error;
      }
    }
  } else {
    // Load global config
    const globalConfig = await loadGlobalConfig({ quiet });
    if (Object.keys(globalConfig).length > 0) {
      config = deepMerge(config, globalConfig);
      sources.push('global');
    }

    // Load project config
    const { config: projectConfig, source: projectSource } = await loadProjectConfig(projectPath, { quiet });
    if (Object.keys(projectConfig).length > 0) {
      config = deepMerge(config, projectConfig);
      sources.push(`project:${projectSource}`);
    }
  }

  // Apply CLI options to costs
  if (cliOptions.monthlyLoads !== undefined) {
    config.costs = config.costs || {};
    config.costs.monthlyPageLoads = parseInt(cliOptions.monthlyLoads, 10);
    sources.push('cli');
  }
  if (cliOptions.bandwidthCost !== undefined) {
    config.costs = config.costs || {};
    config.costs.bandwidthPerGb = parseFloat(cliOptions.bandwidthCost);
    sources.push('cli');
  }
  if (cliOptions.cacheHitRate !== undefined) {
    config.costs = config.costs || {};
    config.costs.cacheHitRate = parseFloat(cliOptions.cacheHitRate);
    sources.push('cli');
  }
  if (cliOptions.storageCost !== undefined) {
    config.costs = config.costs || {};
    config.costs.storagePerGbMonth = parseFloat(cliOptions.storageCost);
    sources.push('cli');
  }
  if (cliOptions.developerRate !== undefined) {
    config.costs = config.costs || {};
    config.costs.developerHourlyRate = parseFloat(cliOptions.developerRate);
    sources.push('cli');
  }
  if (cliOptions.co2PerGb !== undefined) {
    config.costs = config.costs || {};
    config.costs.co2PerGb = parseFloat(cliOptions.co2PerGb);
    sources.push('cli');
  }
  if (cliOptions.currency !== undefined) {
    config.costs = config.costs || {};
    config.costs.currency = cliOptions.currency.toUpperCase();
    config.costs.currencySymbol = getCurrencySymbol(config.costs.currency);
    sources.push('cli');
  }
  if (cliOptions.costMode !== undefined) {
    config.costs = config.costs || {};
    config.costs.mode = cliOptions.costMode;
    sources.push('cli');
  }

  // Ensure currency symbol is set
  if (config.costs && config.costs.currency && !config.costs.currencySymbol) {
    config.costs.currencySymbol = getCurrencySymbol(config.costs.currency);
  }

  // Add source metadata (deduplicated)
  config._source = [...new Set(sources)].join(' < ');
  config._sources = [...new Set(sources)];

  return config;
}

/**
 * Validate configuration
 */
export function validateConfig(config) {
  const errors = [];

  if (config.thresholds) {
    if (typeof config.thresholds.wastePercent === 'number') {
      if (config.thresholds.wastePercent < 0 || config.thresholds.wastePercent > 100) {
        errors.push('thresholds.wastePercent must be between 0 and 100');
      }
    }
  }

  if (config.emissions) {
    if (config.emissions.monthlyVisitors < 0) {
      errors.push('emissions.monthlyVisitors must be non-negative');
    }
    if (config.emissions.cacheRate < 0 || config.emissions.cacheRate > 1) {
      errors.push('emissions.cacheRate must be between 0 and 1');
    }
  }

  if (config.costs) {
    if (config.costs.cacheHitRate < 0 || config.costs.cacheHitRate > 1) {
      errors.push('costs.cacheHitRate must be between 0 and 1');
    }
    if (config.costs.monthlyPageLoads < 0) {
      errors.push('costs.monthlyPageLoads must be non-negative');
    }
    if (config.costs.bandwidthPerGb < 0) {
      errors.push('costs.bandwidthPerGb must be non-negative');
    }
    if (config.costs.mode && !['served', 'storage'].includes(config.costs.mode)) {
      errors.push('costs.mode must be "served" or "storage"');
    }
  }

  // Validate CI config
  if (config.ci) {
    // Validate Slack config
    if (config.ci.slack) {
      if (config.ci.slack.notify && !['always', 'on-failure', 'on-regression'].includes(config.ci.slack.notify)) {
        errors.push('ci.slack.notify must be "always", "on-failure", or "on-regression"');
      }
    }

    // Validate GitHub config
    if (config.ci.github?.annotations) {
      if (config.ci.github.annotations.maxAnnotations !== undefined) {
        const max = config.ci.github.annotations.maxAnnotations;
        if (typeof max !== 'number' || max < 1 || max > 1000) {
          errors.push('ci.github.annotations.maxAnnotations must be a number between 1 and 1000');
        }
      }
    }

    // Validate GitLab config
    if (config.ci.gitlab?.codequality) {
      if (config.ci.gitlab.codequality.outputPath !== undefined) {
        if (typeof config.ci.gitlab.codequality.outputPath !== 'string') {
          errors.push('ci.gitlab.codequality.outputPath must be a string');
        }
      }
    }

    // Validate Jenkins config
    if (config.ci.jenkins?.console) {
      if (config.ci.jenkins.console.format && !['structured'].includes(config.ci.jenkins.console.format)) {
        errors.push('ci.jenkins.console.format must be "structured"');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get project ID from .swynx.json
 * @param {string} projectPath - Project directory path
 * @returns {Promise<string|null>} Project ID or null if not found
 */
export async function getProjectId(projectPath) {
  const configPath = join(projectPath, '.swynx.json');

  try {
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    return config.projectId || null;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; // Config file doesn't exist
    }
    // Config exists but couldn't be read/parsed
    return null;
  }
}

/**
 * Set project ID in .swynx.json
 * Merges with existing config, preserving other settings
 * @param {string} projectPath - Project directory path
 * @param {string} projectId - Project ID to set
 * @returns {Promise<{success: boolean, path: string}>}
 */
export async function setProjectId(projectPath, projectId) {
  const configPath = join(projectPath, '.swynx.json');

  try {
    // Load existing config if present
    let config = {};
    try {
      const content = await readFile(configPath, 'utf-8');
      config = JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid - start fresh
    }

    // Set/update projectId
    config.projectId = projectId;

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true, path: configPath };
  } catch (error) {
    throw new Error(`Failed to save project ID: ${error.message}`);
  }
}

/**
 * Check if project has a .swynx.json config file
 * @param {string} projectPath - Project directory path
 * @returns {boolean}
 */
export function hasProjectConfig(projectPath) {
  return existsSync(join(projectPath, '.swynx.json'));
}

export default { loadConfig, loadGlobalConfig, saveGlobalConfig, saveProjectConfig, validateConfig, getProjectId, setProjectId, hasProjectConfig, DEFAULT_CONFIG };
