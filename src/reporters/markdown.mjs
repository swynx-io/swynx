/**
 * Markdown reporter - generates a .md document suitable for PRs, wikis, etc.
 */

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function verdictLabel(file) {
  if (!file.verdict) return '';
  const ev = file.evidence;
  const pct = ev?.confidence?.score ? `${Math.round(ev.confidence.score * 100)}%` : '';
  if (file.verdict === 'possibly-live') return `Possibly Live ${pct}`;
  if (file.verdict === 'partially-unreachable') return `Partial ${pct}`;
  return `Unreachable ${pct}`;
}

/**
 * @param {object} results
 * @param {object} [options]
 * @returns {string}
 */
export function report(results, options = {}) {
  const {
    totalFiles = 0,
    entryPoints = 0,
    reachableFiles = 0,
    deadFiles = [],
  } = results;

  const deadCount = deadFiles.length;
  const deadPct = totalFiles > 0 ? ((deadCount / totalFiles) * 100).toFixed(2) : '0.00';
  const deadBytes = deadFiles.reduce((sum, f) => sum + (f.size || 0), 0);

  const lines = [];

  const dfCount = (results.deadFunctions || []).length;
  const cweCount = deadCount + dfCount;

  lines.push('# Swynx Dead Code Report');
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| ------ | ----- |');
  lines.push(`| Total files scanned | ${totalFiles} |`);
  lines.push(`| Entry points | ${entryPoints} |`);
  lines.push(`| Reachable files | ${reachableFiles} |`);
  lines.push(`| Dead files | ${deadCount} (${deadPct}%) |`);
  lines.push(`| Dead functions | ${dfCount} |`);
  lines.push(`| Dead code size | ${formatBytes(deadBytes)} |`);
  lines.push(`| **CWE-561 instances** | **${cweCount}** |`);
  lines.push('');

  if (deadCount === 0) {
    lines.push('> No dead code detected.');
    lines.push('');
    return lines.join('\n');
  }

  // Dead files table with verdict column
  lines.push('## CWE-561: Dead Files');
  lines.push('');
  lines.push('| # | File | Size | CWE | Verdict |');
  lines.push('| - | ---- | ---- | --- | ------- |');

  deadFiles.forEach((file, i) => {
    const size = file.size != null ? formatBytes(file.size) : '';
    const verdict = verdictLabel(file);
    lines.push(`| ${i + 1} | \`${file.path}\` | ${size} | CWE-561 | ${verdict} |`);
  });

  lines.push('');

  // Detailed list
  lines.push('### Details');
  lines.push('');

  deadFiles.forEach((file, i) => {
    const meta = [];
    if (file.size != null) meta.push(formatBytes(file.size));
    if (file.lines != null) meta.push(`${file.lines} lines`);
    const metaStr = meta.length ? ` (${meta.join(', ')})` : '';

    lines.push(`${i + 1}. \`${file.path}\`${metaStr}`);

    if (file.exports && file.exports.length > 0) {
      lines.push(`   - Exports: ${file.exports.map((e) => `\`${e}\``).join(', ')}`);
    }

    // Evidence summary
    if (file.evidence) {
      const ev = file.evidence;
      const evParts = [];
      if (ev.entryPoints) evParts.push(`Not reachable from ${ev.entryPoints.total} entry points`);
      if (ev.dynamicCheck?.matchedPattern) evParts.push(`Matches "${ev.dynamicCheck.matchedPattern}" pattern`);
      if (ev.confidence) evParts.push(`Confidence: ${Math.round(ev.confidence.score * 100)}% (${ev.confidence.label})`);
      if (evParts.length > 0) {
        lines.push(`   - Evidence: ${evParts.join('. ')}`);
      }
    }

    if (file.aiQualification) {
      const ai = file.aiQualification;
      if (ai.error) {
        lines.push(`   - AI: ${ai.error}`);
      } else {
        const pct = Math.round(ai.confidence * 100);
        lines.push(`   - AI: **${pct}% dead** · ${ai.recommendation}`);
        if (ai.explanation) {
          lines.push(`   - _${ai.explanation}_`);
        }
      }
    }
  });

  // AI summary
  if (results.aiSummary) {
    const ai = results.aiSummary;
    lines.push('');
    lines.push('## AI Qualification');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`| ------ | ----- |`);
    lines.push(`| Model | ${ai.model} |`);
    lines.push(`| Files qualified | ${ai.filesQualified} |`);
    lines.push(`| Confirmed dead | ${ai.confirmedDead} |`);
    lines.push(`| Uncertain | ${ai.uncertain} |`);
    lines.push(`| Likely alive | ${ai.likelyAlive} |`);
    lines.push(`| False positives | ${ai.falsePositives} |`);
    lines.push(`| Duration | ${(ai.duration / 1000).toFixed(1)}s |`);
  }

  lines.push('');
  return lines.join('\n');
}
