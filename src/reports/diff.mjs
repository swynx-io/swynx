/**
 * Scan Diff Generator
 *
 * Compares two scans to identify:
 * - Resolved issues (in previous, not in current)
 * - Still open issues (in both)
 * - New issues (in current, not in previous)
 */

import { extractIssues, generateIssueId } from './action-list.mjs';

/**
 * Generate diff between two scans
 */
export function generateDiff(previousScan, currentScan) {
  const previousIssues = extractIssues(previousScan);
  const currentIssues = extractIssues(currentScan);

  // Create maps for O(1) lookup
  const previousMap = new Map(previousIssues.map(i => [i.id, i]));
  const currentMap = new Map(currentIssues.map(i => [i.id, i]));

  const resolved = [];
  const stillOpen = [];
  const newIssues = [];

  // Find resolved and still open
  for (const [id, issue] of previousMap) {
    if (currentMap.has(id)) {
      // Still open - calculate days open
      const firstSeen = issue.firstSeen || previousScan.scannedAt || previousScan.created_at;
      const daysOpen = Math.ceil(
        (new Date() - new Date(firstSeen)) / (1000 * 60 * 60 * 24)
      );
      stillOpen.push({
        ...currentMap.get(id),
        firstSeen,
        daysOpen,
        previousScan: previousScan.id || previousScan.scanId
      });
    } else {
      // Resolved
      resolved.push({
        ...issue,
        resolvedIn: currentScan.id || currentScan.scanId,
        resolution: 'removed'
      });
    }
  }

  // Find new issues
  for (const [id, issue] of currentMap) {
    if (!previousMap.has(id)) {
      newIssues.push({
        ...issue,
        introducedIn: currentScan.id || currentScan.scanId,
        isNew: true
      });
    }
  }

  // Calculate progress percentage
  const totalPrevious = previousIssues.length;
  const progressPercent = totalPrevious > 0
    ? Math.round((resolved.length / totalPrevious) * 100)
    : 0;

  // Health score change
  const previousHealth = previousScan.healthScore || previousScan.score || previousScan.health_score || 0;
  const currentHealth = currentScan.healthScore || currentScan.score || currentScan.health_score || 0;
  const healthChange = currentHealth - previousHealth;

  return {
    meta: {
      project: currentScan.projectName || currentScan.project_path,
      currentScan: {
        id: currentScan.id || currentScan.scanId,
        date: currentScan.scannedAt || currentScan.timestamp || currentScan.created_at,
        healthScore: currentHealth
      },
      previousScan: {
        id: previousScan.id || previousScan.scanId,
        date: previousScan.scannedAt || previousScan.timestamp || previousScan.created_at,
        healthScore: previousHealth
      },
      healthChange,
      generatedAt: new Date().toISOString()
    },
    summary: {
      resolved: resolved.length,
      stillOpen: stillOpen.length,
      new: newIssues.length,
      progressPercent
    },
    resolved,
    stillOpen,
    new: newIssues
  };
}

/**
 * Generate progress report with recommendations
 */
export function generateProgressReport(diff) {
  const { resolved, stillOpen, new: newIssues } = diff;

  // Group still open by severity for priority ordering
  const openBySeverity = {
    critical: stillOpen.filter(i => i.severity === 'critical'),
    high: stillOpen.filter(i => i.severity === 'high'),
    medium: stillOpen.filter(i => i.severity === 'medium'),
    low: stillOpen.filter(i => i.severity === 'low')
  };

  // Generate recommended next actions
  const nextActions = [];

  // Prioritize critical and high severity still open
  for (const issue of openBySeverity.critical.slice(0, 3)) {
    nextActions.push({
      priority: 1,
      issue,
      reason: 'Critical security issue still open'
    });
  }

  for (const issue of openBySeverity.high.slice(0, 2)) {
    nextActions.push({
      priority: 2,
      issue,
      reason: 'High priority issue still open'
    });
  }

  // Include new high/critical issues
  for (const issue of newIssues.filter(i => ['critical', 'high'].includes(i.severity))) {
    nextActions.push({
      priority: 3,
      issue,
      reason: 'New issue introduced'
    });
  }

  return {
    ...diff,
    openBySeverity,
    nextActions: nextActions.slice(0, 5)
  };
}

export default {
  generateDiff,
  generateProgressReport
};
