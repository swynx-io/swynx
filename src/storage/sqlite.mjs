// src/storage/sqlite.mjs
// SQLite storage for scan history using sql.js (pure JS, no native modules)

import initSqlJs from 'sql.js';
import { join, dirname } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { DATA_DIR, ensureDataDir } from '../config/index.mjs';

// Database path in data directory
const DB_PATH = join(DATA_DIR, 'scans.db');

let db = null;
let dbPath = null;
let SQL = null;

/**
 * Initialize sql.js and load or create database
 */
export async function initDatabase(customPath = null) {
  dbPath = customPath || DB_PATH;

  // Ensure data directory exists
  ensureDataDir();

  // Initialize sql.js
  if (!SQL) {
    SQL = await initSqlJs();
  }

  // Load existing database or create new one
  if (existsSync(dbPath)) {
    try {
      const fileBuffer = readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } catch (err) {
      console.error('Failed to load existing database, creating new:', err.message);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      scanned_at TEXT NOT NULL,
      duration INTEGER,
      health_score INTEGER,
      waste_percent REAL,
      waste_bytes INTEGER,
      total_bytes INTEGER,
      security_critical INTEGER DEFAULT 0,
      security_high INTEGER DEFAULT 0,
      security_medium INTEGER DEFAULT 0,
      security_low INTEGER DEFAULT 0,
      outdated_count INTEGER DEFAULT 0,
      co2_monthly REAL,
      raw_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_scans_project_path ON scans(project_path)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON scans(scanned_at)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT UNIQUE NOT NULL,
      name TEXT,
      last_scanned TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Project config table for storing CI integrations, costs, etc. per project
  db.run(`
    CREATE TABLE IF NOT EXISTS project_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT UNIQUE NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_project_config_path ON project_config(project_path)`);

  // Resolutions table — tracks dead exports resolved via the inline editor
  db.run(`
    CREATE TABLE IF NOT EXISTS resolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      scan_id TEXT NOT NULL,
      file TEXT NOT NULL,
      export_name TEXT NOT NULL,
      resolved_at TEXT NOT NULL,
      UNIQUE(scan_id, file, export_name)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_resolutions_scan_id ON resolutions(scan_id)`);

  // Save after schema creation
  saveDatabase();

  return db;
}

/**
 * Save database to file
 */
function saveDatabase() {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
  }
}

/**
 * Get or initialize database connection
 */
async function getDb() {
  if (!db) {
    await initDatabase();
  }
  return db;
}

/**
 * Execute a query and return all results
 */
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }

  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

/**
 * Execute a query and return first result
 */
function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

/**
 * Save a scan result
 */
export async function saveScan(scanResult) {
  await getDb();

  db.run(`
    INSERT OR REPLACE INTO scans (
      id, project_path, scanned_at, duration, health_score,
      waste_percent, waste_bytes, total_bytes,
      security_critical, security_high, security_medium, security_low,
      outdated_count, co2_monthly, raw_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    scanResult.id,
    scanResult.projectPath,
    scanResult.scannedAt,
    scanResult.duration,
    scanResult.healthScore?.score || 0,
    scanResult.summary?.wastePercent || 0,
    scanResult.summary?.wasteSizeBytes || 0,
    scanResult.summary?.totalSizeBytes || 0,
    scanResult.security?.summary?.critical || 0,
    scanResult.security?.summary?.high || 0,
    scanResult.security?.summary?.medium || 0,
    scanResult.security?.summary?.low || 0,
    scanResult.outdated?.summary?.total || scanResult.outdated?.packages?.length || scanResult.outdated?.length || 0,
    scanResult.emissions?.monthly?.kgCO2 || 0,
    JSON.stringify(scanResult)
  ]);

  // Update projects table
  db.run(`
    INSERT OR REPLACE INTO projects (project_path, last_scanned)
    VALUES (?, ?)
  `, [scanResult.projectPath, scanResult.scannedAt]);

  // Persist to disk
  saveDatabase();

  return scanResult.id;
}

/**
 * Get recent scans for a project
 */
const SCAN_COLUMNS = [
  'id',
  'project_path',
  'scanned_at',
  'duration',
  'health_score',
  'waste_percent',
  'waste_bytes',
  'total_bytes',
  'security_critical',
  'security_high',
  'security_medium',
  'security_low',
  'outdated_count',
  'co2_monthly',
  'raw_data',
  'created_at'
];

function buildScanSelect(includeRaw) {
  if (includeRaw) {
    return 'SELECT * FROM scans';
  }

  const columns = SCAN_COLUMNS.filter((column) => column !== 'raw_data');
  return `SELECT ${columns.join(', ')} FROM scans`;
}

export async function getRecentScans(projectPath, limit = 20, options = {}) {
  await getDb();

  const baseQuery = buildScanSelect(!!options.includeRaw);
  return queryAll(`
    ${baseQuery}
    WHERE project_path = ?
    ORDER BY scanned_at DESC
    LIMIT ?
  `, [projectPath, limit]);
}

/**
 * Get a single scan by ID
 */
export async function getScanById(scanId) {
  await getDb();
  return queryOne('SELECT * FROM scans WHERE id = ?', [scanId]);
}

/**
 * Get all scans (optionally filtered)
 */
export async function getAllScans(options = {}) {
  await getDb();

  let query = buildScanSelect(!!options.includeRaw);
  const params = [];

  if (options.projectPath) {
    query += ' WHERE project_path = ?';
    params.push(options.projectPath);
  }

  query += ' ORDER BY scanned_at DESC';

  if (options.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);
  }

  return queryAll(query, params);
}

/**
 * Get all projects
 */
export async function getProjects() {
  await getDb();
  return queryAll('SELECT * FROM projects ORDER BY last_scanned DESC');
}

/**
 * Get stats for a project over time
 */
export async function getProjectStats(projectPath, days = 30) {
  await getDb();

  return queryAll(`
    SELECT
      scanned_at,
      health_score,
      waste_percent,
      waste_bytes,
      total_bytes,
      security_critical + security_high AS security_issues,
      outdated_count,
      co2_monthly
    FROM scans
    WHERE project_path = ?
      AND scanned_at >= datetime('now', '-' || ? || ' days')
    ORDER BY scanned_at ASC
  `, [projectPath, days]);
}

/**
 * Get project config from database
 * @param {string} projectPath - Project path
 * @returns {Promise<object>} Config object
 */
export async function getProjectConfigFromDb(projectPath) {
  await getDb();

  const results = queryAll(`
    SELECT config_json FROM project_config WHERE project_path = ?
  `, [projectPath]);

  if (results.length === 0) {
    return {};
  }

  try {
    return JSON.parse(results[0].config_json || '{}');
  } catch {
    return {};
  }
}

/**
 * Save project config to database
 * @param {string} projectPath - Project path
 * @param {object} config - Config object to save (will be merged with existing)
 * @returns {Promise<{success: boolean}>}
 */
export async function saveProjectConfigToDb(projectPath, config) {
  await getDb();

  // Get existing config and merge
  const existing = await getProjectConfigFromDb(projectPath);
  const merged = deepMergeConfig(existing, config);
  const configJson = JSON.stringify(merged);

  db.run(`
    INSERT INTO project_config (project_path, config_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(project_path) DO UPDATE SET
      config_json = excluded.config_json,
      updated_at = excluded.updated_at
  `, [projectPath, configJson]);

  saveDatabase();
  return { success: true };
}

/**
 * Deep merge config objects
 */
function deepMergeConfig(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMergeConfig(result[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Save resolutions (dead exports resolved via editor)
 * @param {string} projectPath
 * @param {string} scanId
 * @param {Array<{file: string, exportName: string}>} resolutions
 */
export async function saveResolutions(projectPath, scanId, resolutions) {
  await getDb();

  const now = new Date().toISOString();
  for (const r of resolutions) {
    db.run(`
      INSERT OR IGNORE INTO resolutions (project_path, scan_id, file, export_name, resolved_at)
      VALUES (?, ?, ?, ?, ?)
    `, [projectPath, scanId, r.file, r.exportName, now]);
  }

  saveDatabase();
  return { success: true, count: resolutions.length };
}

/**
 * Get resolutions for a scan
 * @param {string} scanId
 * @returns {Promise<Array<{file: string, export_name: string, resolved_at: string}>>}
 */
export async function getResolutions(scanId) {
  await getDb();
  return queryAll('SELECT file, export_name, resolved_at FROM resolutions WHERE scan_id = ?', [scanId]);
}

/**
 * Close database connection
 */
export function closeDatabase() {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}

export default {
  initDatabase,
  saveScan,
  getRecentScans,
  getScanById,
  getAllScans,
  getProjects,
  getProjectStats,
  getProjectConfigFromDb,
  saveProjectConfigToDb,
  saveResolutions,
  getResolutions,
  closeDatabase
};
