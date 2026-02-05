/**
 * Action List Generator
 *
 * Converts scan results into a prioritized checklist of issues.
 * Each issue gets a stable ID for tracking across scans.
 */

import { createHash } from 'crypto';

/**
 * Generate a stable issue ID based on category and identifier
 */
export function generateIssueId(category, identifier) {
  const key = `${category}:${identifier}`;
  return createHash('sha256').update(key).digest('hex').substring(0, 12);
}

/**
 * Extract all issues from a scan result
 */
export function extractIssues(scanData) {
  const issues = [];
  const raw = scanData.raw || scanData;

  // Security vulnerabilities - these should be highest priority
  const vulns = raw?.security?.vulnerabilities || raw?.details?.security?.vulnerabilities || [];
  for (const vuln of vulns) {
    const pkgName = vuln.package || vuln.name;
    const version = vuln.version || vuln.installedVersion || vuln.installed;
    const versionStr = version ? `@${version}` : '';
    const id = generateIssueId('security', `${pkgName}${versionStr}`);

    // Determine if this is a direct or transitive dependency
    const isDirect = vuln.isDirect !== false; // Default to direct if not specified
    const fixCmd = isDirect
      ? `npm install ${pkgName}@${vuln.fixedIn || 'latest'}`
      : `npm ls ${pkgName}  # Find source, then: npm audit fix`;

    issues.push({
      id,
      severity: mapSeverity(vuln.severity),  // Security maintains its severity
      category: 'security',
      title: `Vulnerable dependency: ${pkgName}${versionStr}`,
      description: vuln.title || vuln.advisory || 'Security vulnerability detected',
      cve: vuln.cve || vuln.id,
      exploitable: vuln.exploitable,
      usageLocations: vuln.usageLocations || [],
      file: 'package.json',
      isDirect,
      fix: {
        command: fixCmd,
        effort: isDirect ? '5 min' : '10 min',
        type: 'dependency-update'
      },
      impact: { security: vuln.severity }
    });
  }

  // Unused dependencies - lower priority than security issues
  const unusedDeps = raw?.details?.unusedDeps || [];
  for (const dep of unusedDeps) {
    const id = generateIssueId('unused-dependency', dep.name);
    const sizeBytes = dep.sizeBytes || dep.size;
    const version = dep.version || dep.installedVersion;
    issues.push({
      id,
      severity: 'low',  // Unused deps are cleanup tasks, not urgent
      category: 'unused-dependency',
      title: `Unused dependency: ${dep.name}`,
      description: sizeBytes && sizeBytes > 0
        ? `${version ? version + ' ' : ''}${formatBytes(sizeBytes)} installed but never imported`
        : `${version ? version + ' installed but ' : ''}never imported`,
      file: 'package.json',
      size: sizeBytes,
      fix: {
        command: `npm uninstall ${dep.name}`,
        effort: '1 min',
        type: 'uninstall'
      },
      impact: {
        cost: dep.annualCost,
        co2: dep.annualCo2,
        bytes: sizeBytes
      }
    });
  }

  // Unused file candidates (stored in details)
  // Lower priority than security - these are candidates for cleanup
  const deadFiles = raw?.details?.deadCode?.fullyDeadFiles || raw?.details?.deadCode?.orphanFiles || [];
  for (const file of deadFiles) {
    const filePath = typeof file === 'string' ? file : (file.file || file.relativePath || file.path);
    const id = generateIssueId('dead-code', filePath);
    const lineCount = file.lineCount || file.lines;
    const sizeBytes = file.sizeBytes || file.size;
    const confidence = file.recommendation?.confidence || 'medium';

    issues.push({
      id,
      severity: 'medium',  // Unused code is cleanup, not urgent
      category: 'dead-code',
      title: `Unused file candidate: ${filePath}`,
      description: lineCount ? `${lineCount} lines, no imports detected - verify before removing` : 'No imports detected - verify before removing',
      file: filePath,
      lines: lineCount,
      size: sizeBytes,
      confidence,
      fix: {
        // Don't suggest rm directly - suggest verification first
        command: confidence === 'high'
          ? `rm ${filePath}`
          : `# Verify before removing:\ngrep -r "${filePath.split('/').pop().replace(/\.[^.]+$/, '')}" --include="*.html" --include="*.json" .`,
        effort: confidence === 'high' ? '1 min' : '5 min',
        type: 'review-then-delete'
      },
      impact: {
        bytes: sizeBytes
      }
    });
  }

  // Outdated dependencies (stored at root level, not in details)
  const outdated = raw?.outdated?.packages || raw?.details?.outdated || [];
  for (const dep of outdated) {
    const name = dep.package || dep.name;
    const id = generateIssueId('outdated', name);
    const severity = dep.updateType === 'major' ? 'medium' : 'low';
    issues.push({
      id,
      severity,
      category: 'outdated',
      title: `Outdated: ${name} ${dep.current} → ${dep.latest}`,
      description: `${dep.updateType} update available`,
      file: 'package.json',
      current: dep.current,
      latest: dep.latest,
      updateType: dep.updateType,
      fix: {
        command: `npm install ${name}@${dep.latest}`,
        effort: dep.updateType === 'major' ? '30 min' : '5 min',
        type: 'dependency-update'
      }
    });
  }

  // Duplicates (stored in details) - lower priority than security
  const duplicateFunctions = raw?.details?.duplicates?.duplicateFunctions || raw?.duplicates?.duplicateFunctions || [];
  for (const dup of duplicateFunctions) {
    const id = generateIssueId('duplicate', dup.name || dup.hash);
    const locationCount = dup.occurrences?.length || dup.locations?.length || 2;
    // Only include duplicates that are in multiple files
    const locations = dup.occurrences || dup.locations || [];
    const uniqueFiles = new Set(locations.map(l => l.file || l.relativePath));

    // Skip if all occurrences are in the same file (likely false positive)
    if (uniqueFiles.size < 2) continue;

    issues.push({
      id,
      severity: 'low',  // Duplicates are refactoring tasks, not urgent
      category: 'duplicate',
      title: `Duplicate function: ${dup.name || 'anonymous'}`,
      description: `Found in ${locationCount} locations across ${uniqueFiles.size} files`,
      locations,
      similarity: dup.similarity,
      fix: {
        command: 'Consolidate to shared function',
        effort: '15 min',
        type: 'refactor'
      }
    });
  }

  // License risks
  const licenses = raw?.licenses?.byLicense || {};
  const highRiskLicenses = ['GPL', 'AGPL', 'LGPL', 'SSPL'];
  for (const [license, packages] of Object.entries(licenses)) {
    if (highRiskLicenses.some(hr => license.toUpperCase().includes(hr))) {
      for (const pkg of (packages || [])) {
        const id = generateIssueId('license-risk', `${pkg}:${license}`);
        issues.push({
          id,
          severity: 'medium',
          category: 'license-risk',
          title: `License risk: ${pkg} (${license})`,
          description: 'Copyleft license may require source disclosure',
          package: pkg,
          license,
          fix: {
            command: 'Review license compatibility or find alternative',
            effort: '30 min',
            type: 'review'
          }
        });
      }
    }
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return issues;
}

/**
 * Map various severity formats to standard
 */
function mapSeverity(sev) {
  if (!sev) return 'medium';
  const s = sev.toLowerCase();
  if (s === 'critical' || s === 'crit') return 'critical';
  if (s === 'high') return 'high';
  if (s === 'moderate' || s === 'medium' || s === 'mod') return 'medium';
  return 'low';
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (isNaN(i) || i < 0) return '0 B';
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[Math.min(i, sizes.length - 1)];
}

/**
 * Generate action list from scan
 */
export function generateActionList(scanData, projectInfo = {}) {
  const issues = extractIssues(scanData);

  const summary = {
    critical: issues.filter(i => i.severity === 'critical').length,
    high: issues.filter(i => i.severity === 'high').length,
    medium: issues.filter(i => i.severity === 'medium').length,
    low: issues.filter(i => i.severity === 'low').length,
    total: issues.length
  };

  // Find quick wins (low effort, high impact)
  const quickWins = issues
    .filter(i => i.fix?.effort === '1 min' || i.fix?.effort === '5 min')
    .slice(0, 5);

  return {
    meta: {
      project: projectInfo.name || scanData.projectName || 'Unknown',
      path: projectInfo.path || scanData.projectPath || scanData.project_path,
      scanId: scanData.id || scanData.scanId,
      scanDate: scanData.scannedAt || scanData.timestamp || scanData.created_at,
      healthScore: scanData.healthScore || scanData.score || scanData.health_score,
      grade: scanData.grade,
      generatedAt: new Date().toISOString(),
      swynxVersion: '1.0.0'
    },
    summary,
    issues,
    quickWins
  };
}

export default {
  generateIssueId,
  extractIssues,
  generateActionList
};
