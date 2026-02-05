// src/cli/commands/migrate-storage.mjs
// Migrate scan data from global storage to project-local directories
// Required for Layer 3: Complete Data Containment

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync, statSync } from 'fs';
import { join, basename } from 'path';
import initSqlJs from 'sql.js';
import { DATA_DIR } from '../../config/index.mjs';

const GLOBAL_DIR = DATA_DIR;
const LEGACY_DB = join(GLOBAL_DIR, 'scans.db');

/**
 * Migrate scans from global SQLite to project-local storage
 */
export async function migrateStorage(options = {}) {
  const results = {
    success: true,
    projectsMigrated: 0,
    scansMigrated: 0,
    bytesFreed: 0,
    errors: [],
    projectPaths: []
  };

  // Check if legacy database exists
  if (!existsSync(LEGACY_DB)) {
    return {
      ...results,
      message: 'No global scan database found. Storage is already compliant.'
    };
  }

  let db;
  try {
    const SQL = await initSqlJs();
    const fileBuffer = readFileSync(LEGACY_DB);
    db = new SQL.Database(fileBuffer);
  } catch (err) {
    return {
      success: false,
      message: `Failed to open legacy database: ${err.message}`,
      errors: [err.message]
    };
  }

  try {
    // Get all unique projects from the database
    const projectsResult = db.exec(`
      SELECT DISTINCT s.project_path, p.name as project_name
      FROM scans s
      LEFT JOIN projects p ON s.project_path = p.project_path
      WHERE s.project_path IS NOT NULL
    `);

    const projects = projectsResult.length > 0 ? projectsResult[0].values.map(row => ({
      project_path: row[0],
      project_name: row[1]
    })) : [];

    if (projects.length === 0) {
      db.close();
      return {
        ...results,
        message: 'No project scans found in global database.'
      };
    }

    // Migrate each project
    for (const project of projects) {
      const projectPath = project.project_path;
      const projectName = project.project_name || basename(projectPath);

      if (!existsSync(projectPath)) {
        results.errors.push(`Project path no longer exists: ${projectPath}`);
        continue;
      }

      // Create project-local .swynx directory
      const localDir = join(projectPath, '.swynx');
      const localScansDir = join(localDir, 'scans');

      if (!existsSync(localDir)) {
        mkdirSync(localDir, { recursive: true });
      }
      if (!existsSync(localScansDir)) {
        mkdirSync(localScansDir, { recursive: true });
      }

      // Get all scans for this project
      const scansResult = db.exec(`
        SELECT * FROM scans
        WHERE project_path = ?
        ORDER BY created_at DESC
      `, [projectPath]);

      const columns = scansResult.length > 0 ? scansResult[0].columns : [];
      const scans = scansResult.length > 0 ? scansResult[0].values.map(row => {
        const obj = {};
        columns.forEach((col, idx) => { obj[col] = row[idx]; });
        return obj;
      }) : [];

      // Write each scan as a JSON file - handle large data efficiently
      for (const scan of scans) {
        const scanId = scan.id || Date.now();
        const scanFile = join(localScansDir, `scan-${scanId}.json`);

        try {
          // Build metadata object (small, without raw_data)
          const metadata = {
            id: scan.id,
            projectPath: scan.project_path,
            projectName: projectName,
            scannedAt: scan.scanned_at,
            createdAt: scan.created_at,
            duration: scan.duration,
            healthScore: scan.health_score,
            wastePercent: scan.waste_percent,
            wasteBytes: scan.waste_bytes,
            totalBytes: scan.total_bytes,
            security: {
              critical: scan.security_critical,
              high: scan.security_high,
              medium: scan.security_medium,
              low: scan.security_low
            },
            outdatedCount: scan.outdated_count,
            co2Monthly: scan.co2_monthly
          };

          // Write metadata file
          const metadataFile = join(localScansDir, `scan-${scanId}-meta.json`);
          writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));

          // Write raw data separately if it exists (as-is, no parsing)
          if (scan.raw_data) {
            const rawFile = join(localScansDir, `scan-${scanId}-data.json`);
            writeFileSync(rawFile, scan.raw_data);
          }

          results.scansMigrated++;
        } catch (writeErr) {
          results.errors.push(`Failed to write scan ${scanId}: ${writeErr.message}`);
        }
      }

      // Create a gitignore for the local storage
      const gitignorePath = join(localDir, '.gitignore');
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, `# Swynx local storage
# This directory contains scan results - do not commit
*
!.gitignore
`);
      }

      results.projectsMigrated++;
      results.projectPaths.push(projectPath);
    }

    db.close();

    // Calculate size of legacy database
    const stats = statSync(LEGACY_DB);
    results.bytesFreed = stats.size;

    // Archive or remove the legacy database
    if (!options.keepLegacy) {
      const archivePath = join(GLOBAL_DIR, `scans.db.migrated-${Date.now()}`);

      if (options.deleteAfterMigration) {
        unlinkSync(LEGACY_DB);
        results.message = `Migration complete. Legacy database deleted.`;
      } else {
        renameSync(LEGACY_DB, archivePath);
        results.message = `Migration complete. Legacy database archived to: ${basename(archivePath)}`;
        results.archivePath = archivePath;
      }
    } else {
      results.message = `Migration complete. Legacy database retained (use --delete to remove).`;
    }

    return results;

  } catch (err) {
    if (db) db.close();
    return {
      success: false,
      message: `Migration failed: ${err.message}`,
      errors: [err.message]
    };
  }
}

/**
 * CLI command handler
 */
export async function migrateStorageCommand(options) {
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const green = '\x1b[32m';
  const yellow = '\x1b[33m';
  const red = '\x1b[31m';
  const reset = '\x1b[0m';

  console.log('');
  console.log(`${bold}Layer 3: Data Containment Migration${reset}`);
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('');
  console.log(`${dim}Moving scan data from global storage to project directories...${reset}`);
  console.log('');

  const results = await migrateStorage(options);

  if (!results.success) {
    console.log(`${red}✗${reset} ${results.message}`);
    if (results.errors?.length > 0) {
      for (const err of results.errors) {
        console.log(`  ${dim}${err}${reset}`);
      }
    }
    console.log('');
    process.exit(1);
  }

  if (results.scansMigrated === 0 && results.projectsMigrated === 0) {
    console.log(`${green}✓${reset} ${results.message}`);
    console.log('');
    console.log(`${dim}Layer 3 compliance: Your data is already contained to project directories.${reset}`);
    console.log('');
    return;
  }

  console.log(`${green}✓${reset} Migration complete`);
  console.log('');
  console.log(`  ${dim}Projects migrated:${reset} ${results.projectsMigrated}`);
  console.log(`  ${dim}Scans migrated:${reset} ${results.scansMigrated}`);
  console.log(`  ${dim}Global storage freed:${reset} ${formatBytes(results.bytesFreed)}`);
  console.log('');

  if (results.projectPaths.length > 0) {
    console.log(`${bold}Migrated Projects:${reset}`);
    for (const path of results.projectPaths) {
      console.log(`  ${dim}→${reset} ${path}/.swynx/`);
    }
    console.log('');
  }

  if (results.errors?.length > 0) {
    console.log(`${yellow}Warnings:${reset}`);
    for (const err of results.errors) {
      console.log(`  ${dim}${err}${reset}`);
    }
    console.log('');
  }

  console.log(results.message);
  console.log('');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`${green}✓${reset} Layer 3 compliant: Scan data now stored in project directories`);
  console.log(`${dim}Run 'swynx security-audit' to verify.${reset}`);
  console.log('');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default { migrateStorage, migrateStorageCommand };
