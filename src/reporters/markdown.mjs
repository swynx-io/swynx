/**
 * Markdown reporter - generates a .md document suitable for PRs, wikis, etc.
 * Frames all output as CWE-561 security findings.
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
  const dfCount = (results.deadFunctions || []).length;
  const cweCount = deadCount + dfCount;

  const lines = [];

  // Header — security-first
  lines.push('# Swynx Security Report — CWE-561');
  lines.push('');

  if (cweCount === 0 && deadCount === 0) {
    lines.push(`> **No CWE-561 instances found** across ${totalFiles} files.`);
    lines.push('');
    return lines.join('\n');
  }

  // Headline
  lines.push(`> **${cweCount} CWE-561 instance${cweCount !== 1 ? 's' : ''}** found across ${totalFiles} files (${deadPct}% of codebase)`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| ------ | ----- |');
  lines.push(`| **CWE-561 instances** | **${cweCount}** |`);
  lines.push(`| Unreachable files | ${deadCount} |`);
  if (dfCount > 0) {
    lines.push(`| Unreachable functions | ${dfCount} |`);
  }
  lines.push(`| Dead code size | ${formatBytes(deadBytes)} |`);
  lines.push(`| Total files scanned | ${totalFiles} |`);
  lines.push(`| Entry points tested | ${entryPoints} |`);
  lines.push(`| Reachable files | ${reachableFiles} |`);
  lines.push('');
  lines.push('> [CWE-561](https://cwe.mitre.org/data/definitions/561.html): *"The product contains dead code, which can never be executed."*');
  lines.push('');

  // Findings table
  lines.push('## Findings');
  lines.push('');
  lines.push('| # | File | Size | CWE | Verdict |');
  lines.push('| - | ---- | ---- | --- | ------- |');

  deadFiles.forEach((file, i) => {
    const size = file.size != null ? formatBytes(file.size) : '';
    const verdict = verdictLabel(file);
    lines.push(`| ${i + 1} | \`${file.path}\` | ${size} | CWE-561 | ${verdict} |`);
  });

  lines.push('');

  // Detailed evidence
  lines.push('### Evidence');
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
