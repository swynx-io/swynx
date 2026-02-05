/**
 * Project Fingerprint Generator
 *
 * Creates a unique identifier for a PROJECT based on:
 * - package.json name
 * - Git remote URL (if available)
 * - Normalised project path
 *
 * This fingerprint locks licenses to specific projects, not servers.
 * The same project on different servers = same fingerprint.
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Generate a project fingerprint
 * Returns a 16-character hex string
 */
export async function getProjectFingerprint(projectPath) {
  const components = [];

  // 1. Package name from package.json (primary identifier)
  const packageName = await getPackageName(projectPath);
  components.push(packageName || 'unnamed-project');

  // 2. Git remote URL (if exists - strong identifier)
  const gitRemote = await getGitRemote(projectPath);
  if (gitRemote) {
    // Normalise git URL (remove .git suffix, protocol differences)
    const normalised = normaliseGitUrl(gitRemote);
    components.push(normalised);
  }

  // 3. Fallback: directory name (for non-git projects)
  if (!gitRemote) {
    const dirName = basename(projectPath);
    components.push(dirName);
  }

  // Combine and hash
  const raw = components.join('|').toLowerCase();
  const hash = createHash('sha256').update(raw).digest('hex');

  // Return first 16 characters
  return hash.slice(0, 16).toUpperCase();
}

/**
 * Get detailed fingerprint info (for display/debugging)
 */
export async function getProjectDetails(projectPath) {
  const packageName = await getPackageName(projectPath);
  const packageVersion = await getPackageVersion(projectPath);
  const gitRemote = await getGitRemote(projectPath);
  const gitBranch = await getGitBranch(projectPath);
  const fingerprint = await getProjectFingerprint(projectPath);
  const folderName = basename(projectPath);

  // Use folder name if package name looks like a template/boilerplate
  const templatePatterns = [
    'vite', 'react', 'vue', 'next', 'nuxt', 'astro', 'svelte',
    'template', 'starter', 'boilerplate', 'example', 'demo',
    'shadcn', 'tailwind', 'my-app', 'my-project', 'untitled'
  ];

  let displayName = packageName;
  if (packageName) {
    const lowerName = packageName.toLowerCase();
    const looksLikeTemplate = templatePatterns.some(p => lowerName.includes(p));
    if (looksLikeTemplate && folderName !== packageName) {
      displayName = folderName;
    }
  }

  return {
    path: projectPath,
    name: displayName || folderName,
    version: packageVersion || 'unknown',
    gitRemote: sanitiseGitUrl(gitRemote) || 'none',
    gitBranch: gitBranch || 'none',
    fingerprint
  };
}

// Helper functions

async function getPackageName(projectPath) {
  try {
    const pkgPath = join(projectPath, 'package.json');
    if (!existsSync(pkgPath)) return null;
    const content = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.name || null;
  } catch {
    return null;
  }
}

async function getPackageVersion(projectPath) {
  try {
    const pkgPath = join(projectPath, 'package.json');
    if (!existsSync(pkgPath)) return null;
    const content = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.version || null;
  } catch {
    return null;
  }
}

async function getGitRemote(projectPath) {
  try {
    const { stdout } = await execAsync('git remote get-url origin', {
      cwd: projectPath,
      timeout: 5000
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getGitBranch(projectPath) {
  try {
    const { stdout } = await execAsync('git branch --show-current', {
      cwd: projectPath,
      timeout: 5000
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function normaliseGitUrl(url) {
  // Remove protocol, credentials, .git suffix, and normalise
  return url
    .replace(/^(https?:\/\/|git@|ssh:\/\/)/, '')
    .replace(/[^@]+@/, '') // Remove credentials (user:pass@)
    .replace(/\.git$/, '')
    .replace(':', '/')
    .toLowerCase();
}

function sanitiseGitUrl(url) {
  // Remove credentials from URL for display purposes
  if (!url) return url;
  // Match https://user:token@host/path or similar
  return url.replace(/(:\/\/)[^@]+@/, '$1');
}

export default { getProjectFingerprint, getProjectDetails };
