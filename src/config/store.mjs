/**
 * Centralized Config Store
 *
 * Unified access to all persistent configuration stored in DATA_DIR.
 * This data survives reinstalls - only the binary is replaceable.
 *
 * Directory structure:
 *   DATA_DIR/  (either /var/lib/swynx or ~/.swynx)
 *   ├── licence.json          # Licence activation data
 *   ├── projects.json         # Registered projects
 *   ├── settings.json         # User preferences
 *   ├── scans.db              # Scan history (SQLite)
 *   ├── network-audit.log     # Security audit log
 *   └── .last-update-check    # Timestamp of last update check
 */

import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { DATA_DIR } from './index.mjs';

// Config directory - persistent across installs
const CONFIG_DIR = DATA_DIR;

// File paths
const LICENCE_FILE = join(CONFIG_DIR, 'licence.json');
const PROJECTS_FILE = join(CONFIG_DIR, 'projects.json');
const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json');
const LAST_UPDATE_CHECK_FILE = join(CONFIG_DIR, '.last-update-check');
const NETWORK_AUDIT_LOG = join(CONFIG_DIR, 'network-audit.log');
const SCANS_DB = join(CONFIG_DIR, 'scans.db');

/**
 * Ensure config directory exists
 */
function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Generic read config file
 */
function readConfig(file, defaultValue = null) {
  ensureConfigDir();
  if (!existsSync(file)) {
    return defaultValue;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return defaultValue;
  }
}

/**
 * Generic write config file
 */
function writeConfig(file, data) {
  ensureConfigDir();
  writeFileSync(file, JSON.stringify(data, null, 2));
}

// ============================================
// LICENCE
// ============================================

/**
 * Get licence data
 * @returns {Object|null} Licence object or null if not activated
 */
function getLicence() {
  return readConfig(LICENCE_FILE, null);
}

/**
 * Save licence data
 * @param {Object} licence - Licence data to save
 */
function saveLicence(licence) {
  writeConfig(LICENCE_FILE, licence);
}

/**
 * Clear licence (deactivate)
 */
function clearLicence() {
  if (existsSync(LICENCE_FILE)) {
    unlinkSync(LICENCE_FILE);
  }
}

/**
 * Check if licence is active and valid
 * @returns {Object} { active, expired, daysRemaining, licence }
 */
function getLicenceStatus() {
  const licence = getLicence();

  if (!licence) {
    return { active: false, reason: 'No licence found' };
  }

  const now = new Date();
  const expires = new Date(licence.expires);
  const daysRemaining = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));

  return {
    active: daysRemaining > 0,
    expired: daysRemaining <= 0,
    daysRemaining: Math.max(0, daysRemaining),
    licence
  };
}

// ============================================
// PROJECTS
// ============================================

/**
 * Get registered projects
 * @returns {Object} { projects: [], maxSlots: number, slotsUsed: number }
 */
function getProjects() {
  const projects = readConfig(PROJECTS_FILE, []);
  const licence = getLicence();

  return {
    projects: Array.isArray(projects) ? projects : [],
    maxSlots: licence?.maxProjects || 0,
    slotsUsed: Array.isArray(projects) ? projects.length : 0
  };
}

/**
 * Save projects
 * @param {Array} projects - Array of project records
 */
function saveProjects(projects) {
  writeConfig(PROJECTS_FILE, projects);
}

/**
 * Add a project to the registry
 * @param {Object} project - Project record
 * @returns {Object} Result with success status
 */
function addProject(project) {
  const { projects, maxSlots, slotsUsed } = getProjects();

  // Check if already registered
  const existing = projects.find(p => p.path === project.path);
  if (existing) {
    return { success: true, alreadyRegistered: true, project: existing };
  }

  // Check slot availability (-1 means unlimited)
  if (maxSlots !== -1 && slotsUsed >= maxSlots) {
    return {
      success: false,
      error: `No slots available. Licence allows ${maxSlots} project(s).`,
      code: 'NO_SLOTS'
    };
  }

  projects.push(project);
  saveProjects(projects);

  return { success: true, alreadyRegistered: false, project };
}

/**
 * Remove a project from the registry
 * @param {string} projectId - Project ID to remove
 * @returns {Object} Result with success status
 */
function removeProjectById(projectId) {
  const { projects } = getProjects();
  const index = projects.findIndex(p => p.id === projectId);

  if (index === -1) {
    return { success: false, error: 'Project not found', code: 'NOT_FOUND' };
  }

  const removed = projects.splice(index, 1)[0];
  saveProjects(projects);

  return { success: true, removedProject: removed };
}

// ============================================
// SETTINGS
// ============================================

/**
 * Get default settings
 */
function getDefaultSettings() {
  return {
    costAssumptions: {
      bandwidthPerGb: 0.08,
      monthlyPageLoads: 10000,
      developerHourlyRate: 75,
      currency: 'GBP'
    },
    dashboard: {
      port: 9000,
      autoOpen: true
    },
    performance: {
      workers: 0  // 0 = auto-detect (uses available CPUs, max 8)
    },
    updates: {
      autoCheck: true,
      channel: 'stable'
    }
  };
}

/**
 * Get settings
 * @returns {Object} Settings object with defaults merged
 */
function getSettings() {
  const defaults = getDefaultSettings();
  const saved = readConfig(SETTINGS_FILE, {});

  // Deep merge
  return deepMerge(defaults, saved);
}

/**
 * Save settings (merges with existing)
 * @param {Object} settings - Settings to save
 */
function saveSettings(settings) {
  const existing = readConfig(SETTINGS_FILE, {});
  const merged = deepMerge(existing, settings);
  writeConfig(SETTINGS_FILE, merged);
}

/**
 * Get a specific setting value
 * @param {string} path - Dot-notation path (e.g., 'updates.autoCheck')
 * @param {*} defaultValue - Default if not found
 */
function getSetting(path, defaultValue = undefined) {
  const settings = getSettings();
  const parts = path.split('.');
  let value = settings;

  for (const part of parts) {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    value = value[part];
  }

  return value !== undefined ? value : defaultValue;
}

/**
 * Set a specific setting value
 * @param {string} path - Dot-notation path
 * @param {*} value - Value to set
 */
function setSetting(path, value) {
  const settings = getSettings();
  const parts = path.split('.');
  let current = settings;

  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }

  current[parts[parts.length - 1]] = value;
  writeConfig(SETTINGS_FILE, settings);
}

// ============================================
// UPDATE CHECK TRACKING
// ============================================

/**
 * Get last update check timestamp
 * @returns {Date|null}
 */
function getLastUpdateCheck() {
  if (!existsSync(LAST_UPDATE_CHECK_FILE)) {
    return null;
  }

  try {
    const timestamp = readFileSync(LAST_UPDATE_CHECK_FILE, 'utf-8').trim();
    return new Date(timestamp);
  } catch {
    return null;
  }
}

/**
 * Record update check timestamp
 */
function recordUpdateCheck() {
  ensureConfigDir();
  writeFileSync(LAST_UPDATE_CHECK_FILE, new Date().toISOString());
}

/**
 * Check if we should check for updates (rate limiting)
 * @param {number} hoursThreshold - Hours between checks (default: 24)
 * @returns {boolean}
 */
function shouldCheckForUpdates(hoursThreshold = 24) {
  // Check if auto-check is disabled
  const autoCheck = getSetting('updates.autoCheck', true);
  if (!autoCheck) {
    return false;
  }

  const lastCheck = getLastUpdateCheck();
  if (!lastCheck) {
    return true;
  }

  const hoursSinceCheck = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60);
  return hoursSinceCheck >= hoursThreshold;
}

// ============================================
// UTILITY
// ============================================

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
 * Get all config info (for debugging/display)
 */
function getConfigInfo() {
  return {
    configDir: CONFIG_DIR,
    files: {
      licence: existsSync(LICENCE_FILE),
      projects: existsSync(PROJECTS_FILE),
      settings: existsSync(SETTINGS_FILE),
      scansDb: existsSync(SCANS_DB),
      networkLog: existsSync(NETWORK_AUDIT_LOG)
    },
    licenceStatus: getLicenceStatus(),
    projects: getProjects(),
    settings: getSettings(),
    lastUpdateCheck: getLastUpdateCheck()
  };
}

// ============================================
// EXPORTS
// ============================================

export {
  // Config directory
  CONFIG_DIR,

  // Licence
  getLicence,
  saveLicence,
  clearLicence,
  getLicenceStatus,

  // Projects
  getProjects,
  saveProjects,
  addProject,
  removeProjectById,

  // Settings
  getSettings,
  saveSettings,
  getSetting,
  setSetting,
  getDefaultSettings,

  // Update checking
  getLastUpdateCheck,
  recordUpdateCheck,
  shouldCheckForUpdates,

  // Utility
  getConfigInfo
};

