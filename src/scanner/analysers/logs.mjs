// src/scanner/analysers/logs.mjs
// Detect and analyse log files that may be bloating the project

import { readdirSync, statSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';

// Common log directory names
const LOG_DIRECTORIES = ['logs', 'log', '.logs', 'var/log'];

// Log file extensions
const LOG_EXTENSIONS = ['.log', '.logs'];

// Size thresholds
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024;  // 10 MB (lowered for visibility)
const HUGE_FILE_THRESHOLD = 100 * 1024 * 1024;  // 100 MB
const TOTAL_LOG_WARNING_THRESHOLD = 50 * 1024 * 1024;  // 50 MB (lowered for visibility)

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Recursively get all files in a directory
 */
function getFilesRecursive(dir, maxDepth = 3, currentDepth = 0) {
  const files = [];

  if (currentDepth > maxDepth || !existsSync(dir)) {
    return files;
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and .git
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        files.push(...getFilesRecursive(fullPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        try {
          const stat = statSync(fullPath);
          files.push({
            path: fullPath,
            name: entry.name,
            sizeBytes: stat.size,
            modified: stat.mtime
          });
        } catch {}
      }
    }
  } catch {}

  return files;
}

/**
 * Analyse log files in a project
 */
export function analyseLogFiles(projectPath) {
  const logFiles = [];
  const logDirectories = [];
  let totalLogBytes = 0;

  // Check for log directories
  for (const logDir of LOG_DIRECTORIES) {
    const dirPath = join(projectPath, logDir);
    if (existsSync(dirPath)) {
      try {
        const stat = statSync(dirPath);
        if (stat.isDirectory()) {
          const files = getFilesRecursive(dirPath);
          let dirSize = 0;

          for (const file of files) {
            dirSize += file.sizeBytes;
            totalLogBytes += file.sizeBytes;

            // Track individual large log files
            if (file.sizeBytes > LARGE_FILE_THRESHOLD) {
              logFiles.push({
                path: file.path,
                relativePath: file.path.replace(projectPath + '/', ''),
                name: file.name,
                sizeBytes: file.sizeBytes,
                sizeFormatted: formatBytes(file.sizeBytes),
                severity: file.sizeBytes > HUGE_FILE_THRESHOLD ? 'critical' : 'warning',
                modified: file.modified
              });
            }
          }

          logDirectories.push({
            path: dirPath,
            relativePath: logDir,
            fileCount: files.length,
            sizeBytes: dirSize,
            sizeFormatted: formatBytes(dirSize)
          });
        }
      } catch {}
    }
  }

  // Scan root for *.log files
  try {
    const rootEntries = readdirSync(projectPath, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isFile() && LOG_EXTENSIONS.includes(extname(entry.name).toLowerCase())) {
        const fullPath = join(projectPath, entry.name);
        try {
          const stat = statSync(fullPath);
          totalLogBytes += stat.size;

          if (stat.size > LARGE_FILE_THRESHOLD) {
            logFiles.push({
              path: fullPath,
              relativePath: entry.name,
              name: entry.name,
              sizeBytes: stat.size,
              sizeFormatted: formatBytes(stat.size),
              severity: stat.size > HUGE_FILE_THRESHOLD ? 'critical' : 'warning',
              modified: stat.mtime
            });
          }
        } catch {}
      }
    }
  } catch {}

  // Sort by size (largest first)
  logFiles.sort((a, b) => b.sizeBytes - a.sizeBytes);
  logDirectories.sort((a, b) => b.sizeBytes - a.sizeBytes);

  // Generate findings
  const findings = [];

  // Get the log directory path for logrotate config
  const logDirPath = logDirectories.length > 0
    ? logDirectories[0].path
    : (logFiles.length > 0 ? logFiles[0].path.replace(/\/[^/]+$/, '') : '/var/log/myapp');

  // Critical: Huge log files (> 100MB with new threshold)
  const hugeFiles = logFiles.filter(f => f.sizeBytes > HUGE_FILE_THRESHOLD);
  if (hugeFiles.length > 0) {
    findings.push({
      rule: 'huge-log-files',
      severity: 'critical',
      category: 'logs',
      message: `${hugeFiles.length} log file${hugeFiles.length > 1 ? 's' : ''} exceeding 100MB detected (${formatBytes(hugeFiles.reduce((s, f) => s + f.sizeBytes, 0))})`,
      files: hugeFiles.map(f => f.relativePath),
      solutions: {
        immediate: {
          title: 'Truncate now to reclaim space',
          description: 'This empties the log files immediately. Logs will grow back without rotation.',
          commands: hugeFiles.slice(0, 5).map(f => `> "${f.relativePath}"`)
        },
        permanent: {
          title: 'Set up log rotation to prevent regrowth',
          description: 'Keeps logs at max 100MB, rotates daily, keeps 7 days compressed.',
          commands: [
            `sudo tee /etc/logrotate.d/myapp << 'EOF'`,
            `${logDirPath}/*.log {`,
            `    daily`,
            `    rotate 7`,
            `    compress`,
            `    delaycompress`,
            `    missingok`,
            `    notifempty`,
            `    size 100M`,
            `}`,
            `EOF`
          ]
        }
      },
      priority: 'critical',
      effort: 'low'
    });
  }

  // Warning: Large log files (> 10MB)
  const largeFiles = logFiles.filter(f => f.sizeBytes > LARGE_FILE_THRESHOLD && f.sizeBytes <= HUGE_FILE_THRESHOLD);
  if (largeFiles.length > 0) {
    findings.push({
      rule: 'large-log-files',
      severity: 'warning',
      category: 'logs',
      message: `${largeFiles.length} large log file${largeFiles.length > 1 ? 's' : ''} detected (${formatBytes(largeFiles.reduce((s, f) => s + f.sizeBytes, 0))})`,
      files: largeFiles.map(f => f.relativePath),
      solutions: {
        immediate: {
          title: 'Truncate now to reclaim space',
          description: 'This empties the log files immediately.',
          commands: largeFiles.slice(0, 5).map(f => `> "${f.relativePath}"`)
        },
        permanent: {
          title: 'Set up log rotation',
          description: 'Automatically manage log file sizes.',
          commands: [
            `sudo tee /etc/logrotate.d/myapp << 'EOF'`,
            `${logDirPath}/*.log {`,
            `    daily`,
            `    rotate 7`,
            `    compress`,
            `    size 50M`,
            `}`,
            `EOF`
          ]
        }
      },
      priority: 'medium',
      effort: 'low'
    });
  }

  // Warning: Total logs exceeding threshold
  if (totalLogBytes > TOTAL_LOG_WARNING_THRESHOLD && findings.length === 0) {
    findings.push({
      rule: 'total-log-size',
      severity: 'warning',
      category: 'logs',
      message: `Total log files size is ${formatBytes(totalLogBytes)}`,
      solutions: {
        permanent: {
          title: 'Set up automated log rotation',
          description: 'Prevent logs from growing too large.',
          commands: [
            `sudo tee /etc/logrotate.d/myapp << 'EOF'`,
            `${logDirPath}/*.log {`,
            `    daily`,
            `    rotate 7`,
            `    compress`,
            `    size 50M`,
            `}`,
            `EOF`
          ]
        }
      },
      priority: 'medium',
      effort: 'low'
    });
  }

  // Always report if any log directories exist (even if small)
  const hasLogInfrastructure = logDirectories.length > 0 || logFiles.length > 0;

  return {
    summary: {
      totalLogBytes,
      totalLogFormatted: formatBytes(totalLogBytes),
      logFileCount: logFiles.length,
      logDirectoryCount: logDirectories.length,
      hugeFileCount: hugeFiles?.length || 0,
      largeFileCount: largeFiles?.length || 0
    },
    logFiles,
    logDirectories,
    findings,
    hasIssues: findings.length > 0,
    hasLogInfrastructure
  };
}

export default { analyseLogFiles };
