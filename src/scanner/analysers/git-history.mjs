// src/scanner/analysers/git-history.mjs
// Git history extraction for decay prediction — Phase 1 of predictive code intelligence

import { execFile } from 'child_process';

/**
 * Extract per-file git history for all files in a repository.
 * Runs a single `git log --numstat` covering the last 365 days,
 * then buckets commits into 30d/90d/180d/365d windows.
 *
 * @param {string} projectPath - Absolute path to the repo root
 * @param {Array} files - Array of file objects (with .relativePath or .path)
 * @param {object} [options]
 * @param {number} [options.timeoutMs=30000] - Timeout for git log
 * @param {string} [options.before] - ISO date string for --before (for backfill)
 * @returns {Promise<Map<string, FileGitHistory>>}
 */
export async function extractGitHistory(projectPath, files, options = {}) {
  const { timeoutMs = 30000, before } = options;

  // Build a set of relative paths we care about
  const fileSet = new Set();
  for (const f of files) {
    const rel = f.relativePath || f.path || f;
    if (typeof rel === 'string') fileSet.add(rel);
  }

  // Empty map for non-git repos or errors
  const emptyResult = () => {
    const map = new Map();
    for (const fp of fileSet) {
      map.set(fp, emptyEntry());
    }
    return map;
  };

  let stdout;
  try {
    stdout = await runGitLog(projectPath, timeoutMs, before);
  } catch {
    return emptyResult();
  }

  if (!stdout || stdout.length === 0) {
    return emptyResult();
  }

  // Parse the git log output
  const now = before ? new Date(before) : new Date();
  const cutoff30 = new Date(now - 30 * 86400000);
  const cutoff90 = new Date(now - 90 * 86400000);
  const cutoff180 = new Date(now - 180 * 86400000);

  // Map<filePath, { commits: [{date, author}], firstDate, lastDate }>
  const fileData = new Map();

  const lines = stdout.split('\n');
  let currentDate = null;
  let currentAuthor = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('COMMIT_START ')) {
      // Format: COMMIT_START <hash> <email> <ISO date>
      const parts = line.split(' ');
      currentAuthor = parts[2] || '';
      currentDate = parts[3] ? new Date(parts[3]) : null;
      continue;
    }

    // numstat lines: <added>\t<removed>\t<file>
    if (currentDate && line.includes('\t')) {
      const tabIdx1 = line.indexOf('\t');
      const tabIdx2 = line.indexOf('\t', tabIdx1 + 1);
      if (tabIdx2 > tabIdx1) {
        let filePath = line.substring(tabIdx2 + 1);

        // Handle renames: {old => new} or old => new
        if (filePath.includes(' => ')) {
          filePath = parseRenamedPath(filePath);
        }

        if (!fileSet.has(filePath)) continue;

        let entry = fileData.get(filePath);
        if (!entry) {
          entry = { commits: [], authors: new Set(), authors90: new Set(), firstDate: currentDate, lastDate: currentDate };
          fileData.set(filePath, entry);
        }

        entry.commits.push(currentDate);
        entry.authors.add(currentAuthor);
        if (currentDate >= cutoff90) {
          entry.authors90.add(currentAuthor);
        }

        if (currentDate > entry.lastDate) entry.lastDate = currentDate;
        if (currentDate < entry.firstDate) entry.firstDate = currentDate;
      }
    }
  }

  // Build result map
  const result = new Map();

  for (const fp of fileSet) {
    const data = fileData.get(fp);
    if (!data) {
      result.set(fp, emptyEntry());
      continue;
    }

    let c30 = 0, c90 = 0, c180 = 0, c365 = 0;
    for (const d of data.commits) {
      c365++;
      if (d >= cutoff180) { c180++; }
      if (d >= cutoff90) { c90++; }
      if (d >= cutoff30) { c30++; }
    }

    result.set(fp, {
      commits30d: c30,
      commits90d: c90,
      commits180d: c180,
      commits365d: c365,
      contributorsAll: data.authors.size,
      contributors90d: data.authors90.size,
      lastCommitDate: data.lastDate.toISOString(),
      firstCommitDate: data.firstDate.toISOString()
    });
  }

  return result;
}

function emptyEntry() {
  return {
    commits30d: 0,
    commits90d: 0,
    commits180d: 0,
    commits365d: 0,
    contributorsAll: 0,
    contributors90d: 0,
    lastCommitDate: null,
    firstCommitDate: null
  };
}

/**
 * Parse renamed file path from git numstat output.
 * Handles formats like: "src/{old.js => new.js}" or "old.js => new.js"
 */
function parseRenamedPath(filePath) {
  // Handle {old => new} format within a directory
  const braceMatch = filePath.match(/^(.*?)\{.*? => (.*?)\}(.*)$/);
  if (braceMatch) {
    return braceMatch[1] + braceMatch[2] + braceMatch[3];
  }
  // Handle plain "old => new" format
  const arrowMatch = filePath.match(/^.*? => (.+)$/);
  if (arrowMatch) {
    return arrowMatch[1];
  }
  return filePath;
}

/**
 * Run git log and return stdout
 */
function runGitLog(projectPath, timeoutMs, before) {
  return new Promise((resolve, reject) => {
    const args = [
      'log',
      '--format=COMMIT_START %H %ae %aI',
      '--numstat',
      '--since=365 days ago'
    ];

    if (before) {
      args.push(`--before=${before}`);
    }

    execFile('git', args, {
      cwd: projectPath,
      maxBuffer: 100 * 1024 * 1024,
      timeout: timeoutMs
    }, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

export default { extractGitHistory };
