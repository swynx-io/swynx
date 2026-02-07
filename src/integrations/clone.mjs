/**
 * Authenticated Clone + Scan
 *
 * Clones a repo using platform credentials, runs the full scanner,
 * cleans up the clone directory, and returns the result.
 */

import { execSync } from 'child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanProject } from '../scanner/index.mjs';
import { saveScan } from '../storage/index.mjs';
import { getSetting } from '../config/store.mjs';
import { getRawConnection, getDecryptedCredentials } from './index.mjs';
import { getPlatform } from './platforms/registry.mjs';

const CLONE_BASE = join(tmpdir(), 'swynx-integrations');
const CLONE_TIMEOUT = 120_000; // 2 minutes
const SCAN_TIMEOUT = 300_000;  // 5 minutes
const CLEANUP_AGE_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Parse "owner/repo" from a repoSlug (supports nested paths like "org/subgroup/repo")
 */
export function parseRepoSlug(slug) {
  const parts = slug.split('/');
  if (parts.length < 2) return { owner: '', repo: parts[0] };
  const repo = parts.pop();
  const owner = parts.join('/');
  return { owner, repo };
}

/**
 * Sanitize .git/config to strip token from remote URL
 */
function sanitizeGitConfig(cloneDir) {
  const configPath = join(cloneDir, '.git', 'config');
  if (!existsSync(configPath)) return;
  try {
    let config = readFileSync(configPath, 'utf8');
    // Replace https://token@host/... with https://***@host/...
    // Also handles https://user:token@host/...
    config = config.replace(
      /https?:\/\/[^@]+@/g,
      'https://***@'
    );
    // Strip codecommit credential helper tokens
    config = config.replace(
      /codecommit::[^/]+:\/\/[^@]+@/g,
      'codecommit://***@'
    );
    writeFileSync(configPath, config);
  } catch {
    // Non-critical — best effort
  }
}

/**
 * Clean up stale clone directories (older than CLEANUP_AGE_MS)
 */
export function cleanupStaleClones() {
  if (!existsSync(CLONE_BASE)) return;
  try {
    const now = Date.now();
    for (const connDir of readdirSync(CLONE_BASE)) {
      const connPath = join(CLONE_BASE, connDir);
      try {
        const stat = statSync(connPath);
        if (stat.isDirectory() && (now - stat.mtimeMs) > CLEANUP_AGE_MS) {
          rmSync(connPath, { recursive: true, force: true });
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // Non-critical
  }
}

/**
 * Clone a repo, scan it, save result, clean up.
 *
 * @param {string} connectionId - Connection ID
 * @param {string} repoSlug - "owner/repo" path
 * @param {{ onProgress?: Function, branch?: string }} options
 * @returns {Promise<object>} Scan result
 */
export async function cloneAndScan(connectionId, repoSlug, { onProgress, branch } = {}) {
  const conn = getRawConnection(connectionId);
  if (!conn) throw new Error('Connection not found');

  const platform = getPlatform(conn.platformId);
  if (!platform) throw new Error(`Unknown platform: ${conn.platformId}`);

  const credentials = getDecryptedCredentials(connectionId);
  if (!credentials) throw new Error('Failed to decrypt credentials');

  const { owner, repo } = parseRepoSlug(repoSlug);
  const cloneDir = join(CLONE_BASE, connectionId, repoSlug.replace(/\//g, '__'));

  // Clean up any previous clone in this slot
  if (existsSync(cloneDir)) {
    rmSync(cloneDir, { recursive: true, force: true });
  }
  mkdirSync(cloneDir, { recursive: true });

  try {
    // 1. Get clone URL
    const cloneUrl = platform.getCloneUrl(credentials, {
      owner, repo, baseUrl: conn.baseUrl
    });
    if (!cloneUrl) throw new Error('Platform did not return a clone URL');

    // 2. Clone
    if (onProgress) onProgress({ phase: 'Cloning repository', percent: 5, detail: repoSlug });

    const branchArg = branch ? `--branch ${branch}` : '';
    execSync(
      `git clone --depth 1 --single-branch ${branchArg} "${cloneUrl}" "${cloneDir}"`,
      {
        timeout: CLONE_TIMEOUT,
        stdio: 'pipe',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      }
    );

    // 3. Sanitize .git/config (strip token)
    sanitizeGitConfig(cloneDir);

    if (onProgress) onProgress({ phase: 'Clone complete', percent: 15, detail: 'Starting scan...' });

    // 4. Scan
    const workers = getSetting('performance.workers', 0) || undefined;
    const scanResult = await scanProject(cloneDir, { onProgress, workers });

    if (!scanResult) throw new Error('Scanner returned empty result');

    // 5. Rewrite projectPath to platform:owner/repo format
    const displayPath = `${conn.platformId}:${repoSlug}`;
    scanResult.projectPath = displayPath;
    if (scanResult.project_path) scanResult.project_path = displayPath;
    // Tag the source
    scanResult.integration = {
      connectionId,
      platformId: conn.platformId,
      repoSlug,
      branch: branch || null,
      clonedAt: new Date().toISOString()
    };

    // 6. Save to DB
    if (onProgress) onProgress({ phase: 'Saving results', percent: 98, detail: 'Saving to database...' });
    await saveScan(scanResult);

    if (onProgress) onProgress({ phase: 'Complete', percent: 100, detail: 'Scan complete' });

    return scanResult;
  } finally {
    // 7. Always clean up clone directory
    try {
      rmSync(cloneDir, { recursive: true, force: true });
    } catch {
      // Non-critical
    }

    // Periodic cleanup of stale dirs
    cleanupStaleClones();
  }
}
