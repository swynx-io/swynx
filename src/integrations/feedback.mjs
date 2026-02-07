/**
 * PR Feedback
 *
 * Builds a PR comment body from scan results and posts it
 * via the platform client. Also sets commit status checks.
 */

import { extractIssues, generateActionList } from '../reports/action-list.mjs';
import { renderActionListMarkdown } from '../reports/renderers/markdown.mjs';
import { getRawConnection, getDecryptedCredentials } from './index.mjs';
import { getPlatform } from './platforms/registry.mjs';
import { parseRepoSlug } from './clone.mjs';

/**
 * Build the PR comment body from scan results
 */
export function buildCommentBody(scanResult) {
  const healthScore = scanResult.healthScore ?? scanResult.health_score ?? scanResult.score ?? '?';

  // Gather metrics
  const deadCodePct = scanResult.details?.deadCode?.summary?.deadPercent
    ?? scanResult.summary?.deadCodePercent
    ?? '?';
  const securityCount = (scanResult.security?.vulnerabilities || []).length;
  const outdatedCount = (scanResult.outdated?.packages || []).length;
  const duplicateCount = scanResult.details?.duplicates?.duplicateFunctions?.length || 0;

  const lines = [];
  lines.push('## Swynx Scan Results');
  lines.push('');
  lines.push(`**Health Score:** ${healthScore}/100`);
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');

  if (deadCodePct !== '?') {
    lines.push(`| Dead Code | ${typeof deadCodePct === 'number' ? deadCodePct.toFixed(1) : deadCodePct}% |`);
  }
  lines.push(`| Security Issues | ${securityCount} |`);
  lines.push(`| Outdated Deps | ${outdatedCount} |`);
  if (duplicateCount > 0) {
    lines.push(`| Duplicates | ${duplicateCount} |`);
  }

  lines.push('');

  // Build full action list in collapsible section
  try {
    const actionList = generateActionList(scanResult);
    const markdown = renderActionListMarkdown(actionList);

    lines.push('<details><summary>Full Action List</summary>');
    lines.push('');
    lines.push(markdown);
    lines.push('');
    lines.push('</details>');
  } catch {
    // If action list generation fails, skip it
    lines.push('*Full action list unavailable*');
  }

  lines.push('');
  lines.push('---');
  lines.push('*Scanned by [Swynx](https://swynx.oynk.co.uk)*');

  return lines.join('\n');
}

/**
 * Map health score to status check state
 */
export function healthToState(healthScore) {
  if (typeof healthScore !== 'number') return 'pending';
  if (healthScore >= 70) return 'success';
  if (healthScore >= 40) return 'pending';
  return 'failure';
}

/**
 * Post scan results as a PR comment + commit status
 *
 * @param {{
 *   connectionId: string,
 *   repoSlug: string,
 *   prNumber: number|string,
 *   sha?: string,
 *   scanResult: object
 * }} options
 * @returns {Promise<{ comment?: object, status?: object }>}
 */
export async function postFeedback({ connectionId, repoSlug, prNumber, sha, scanResult }) {
  const conn = getRawConnection(connectionId);
  if (!conn) throw new Error('Connection not found');

  const platform = getPlatform(conn.platformId);
  if (!platform) throw new Error(`Unknown platform: ${conn.platformId}`);

  const credentials = getDecryptedCredentials(connectionId);
  if (!credentials) throw new Error('Failed to decrypt credentials');

  const { owner, repo } = parseRepoSlug(repoSlug);
  const body = buildCommentBody(scanResult);
  const healthScore = scanResult.healthScore ?? scanResult.health_score ?? scanResult.score;

  const results = {};

  // Post PR comment
  if (prNumber) {
    results.comment = await platform.postPRComment(credentials, {
      owner, repo, prNumber, body, baseUrl: conn.baseUrl
    });
  }

  // Set commit status if sha provided
  if (sha && platform.setCommitStatus) {
    const state = healthToState(healthScore);
    const description = `Health Score: ${healthScore ?? '?'}/100`;
    results.status = await platform.setCommitStatus(credentials, {
      owner, repo, sha, state, description, baseUrl: conn.baseUrl
    });
  }

  return results;
}
