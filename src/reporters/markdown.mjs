/**
 * Markdown reporter - generates a .md document suitable for PRs, wikis, board reports.
 * Written for stakeholders and decision-makers, not just developers.
 */

function formatBytes(bytes) {
  if (bytes == null || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function verdictLabel(file) {
  if (!file.verdict) return '';
  const ev = file.evidence;
  const pct = ev?.confidence?.score != null ? `${Math.round(ev.confidence.score * 100)}%` : '';
  if (file.verdict === 'possibly-live') return `Needs review ${pct}`;
  if (file.verdict === 'partially-unreachable') return `Partially unused ${pct}`;
  return `Unused ${pct}`;
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
  const deadPct = totalFiles > 0 ? ((deadCount / totalFiles) * 100).toFixed(1) : '0.0';
  const deadBytes = deadFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const dfCount = (results.deadFunctions || []).length;
  const ueCount = (results.unusedExports || []).reduce((sum, f) => sum + (f.deadExports || []).length, 0);
  const cweCount = deadCount + dfCount + ueCount;
  const activeFiles = reachableFiles || (totalFiles - deadCount);

  const lines = [];

  lines.push('# Swynx Dead Code Report');
  lines.push('');

  if (cweCount === 0 && deadCount === 0) {
    if (totalFiles === 0) {
      lines.push('> No source files found in this directory.');
    } else {
      lines.push(`> **All clear** — ${totalFiles.toLocaleString()} files scanned, no dead code found.`);
    }
    lines.push('');
    return lines.join('\n');
  }

  // Headline
  const mdHeadline = [];
  if (deadCount > 0) mdHeadline.push(`${deadCount} unused file${deadCount !== 1 ? 's' : ''}`);
  if (dfCount > 0) mdHeadline.push(`${dfCount} unused function${dfCount !== 1 ? 's' : ''}`);
  if (ueCount > 0) mdHeadline.push(`${ueCount} unused export${ueCount !== 1 ? 's' : ''}`);
  lines.push(`> **${mdHeadline.join(', ')} found**${deadCount > 0 ? ` — ${deadPct}% of your codebase is not being used` : ''}`);
  lines.push('');

  // What this means (for non-technical readers)
  lines.push('## What does this mean?');
  lines.push('');
  lines.push('Dead code is source code that exists in your project but is never executed. It adds clutter, slows builds, and increases the surface area for security vulnerabilities.');
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| ------ | ----- |');
  lines.push(`| Files scanned | ${totalFiles.toLocaleString()} |`);
  lines.push(`| Active (in use) | ${activeFiles.toLocaleString()} |`);
  lines.push(`| **Unused files** | **${deadCount}** (${deadPct}%) |`);
  if (dfCount > 0) {
    lines.push(`| **Unused functions** | **${dfCount}** |`);
  }
  if (ueCount > 0) {
    lines.push(`| **Unused exports** | **${ueCount}** |`);
  }
  lines.push(`| Wasted space | ${formatBytes(deadBytes)} |`);
  lines.push('');
  lines.push(`> *Classification: [CWE-561](https://cwe.mitre.org/data/definitions/561.html) — dead code that can never be executed.*`);
  lines.push('');

  // Findings table
  lines.push('## Unused Files');
  lines.push('');
  lines.push('| # | File | Size | Status |');
  lines.push('| - | ---- | ---- | ------ |');

  deadFiles.forEach((file, i) => {
    const size = file.size != null ? formatBytes(file.size) : '';
    const verdict = verdictLabel(file) || 'Unused';
    lines.push(`| ${i + 1} | \`${file.path}\` | ${size} | ${verdict} |`);
  });

  lines.push('');

  // Detail section — available for technical readers
  if (options.verbose !== false) {
    lines.push('<details>');
    lines.push('<summary>Detailed evidence (click to expand)</summary>');
    lines.push('');

    deadFiles.forEach((file, i) => {
      const meta = [];
      if (file.size != null) meta.push(formatBytes(file.size));
      if (file.lines != null) meta.push(`${file.lines} lines`);
      const metaStr = meta.length ? ` (${meta.join(', ')})` : '';

      lines.push(`${i + 1}. \`${file.path}\`${metaStr}`);

      if (file.evidence) {
        const ev = file.evidence;
        const evParts = [];
        if (ev.entryPoints) evParts.push(`No code path reaches this file (checked ${ev.entryPoints.total} starting points)`);
        if (ev.dynamicCheck?.matchedPattern) evParts.push(`May be loaded at runtime via "${ev.dynamicCheck.matchedPattern}"`);
        if (ev.confidence?.score != null) evParts.push(`Confidence: ${Math.round(ev.confidence.score * 100)}%`);
        if (evParts.length > 0) {
          lines.push(`   - ${evParts.join('. ')}`);
        }
      }

      if (file.aiQualification) {
        const ai = file.aiQualification;
        if (ai.error) {
          lines.push(`   - AI check: ${ai.error}`);
        } else {
          const pct = Math.round(ai.confidence * 100);
          lines.push(`   - AI verdict: **${pct}% likely unused** — ${ai.recommendation}`);
          if (ai.explanation) {
            lines.push(`   - _${ai.explanation}_`);
          }
        }
      }
    });

    lines.push('');
    lines.push('</details>');
  }

  // Dead functions
  const deadFunctions = results.deadFunctions || [];
  if (deadFunctions.length > 0) {
    lines.push('');
    lines.push('## Unused Functions');
    lines.push('');
    lines.push('These functions exist in your code but are never called anywhere:');
    lines.push('');
    lines.push('| # | Function | File | Lines |');
    lines.push('| - | -------- | ---- | ----- |');

    deadFunctions.forEach((fn, i) => {
      lines.push(`| ${i + 1} | \`${fn.name}\` | \`${fn.file}\` | ${fn.lineCount || '?'} |`);
    });
  }

  // Unused exports
  const mdUnusedExports = results.unusedExports || [];
  if (mdUnusedExports.length > 0) {
    lines.push('');
    lines.push('## Unused Exports');
    lines.push('');
    lines.push('These files are in use, but some of their exports are never imported anywhere:');
    lines.push('');
    lines.push('| # | Export | File | Line |');
    lines.push('| - | ------ | ---- | ---- |');
    let ueIdx = 0;
    for (const entry of mdUnusedExports) {
      for (const exp of entry.deadExports) {
        ueIdx++;
        lines.push(`| ${ueIdx} | \`${exp.name}\` | \`${entry.file}\` | ${exp.line || '?'} |`);
      }
    }
  }

  // AI summary
  if (results.aiSummary) {
    const ai = results.aiSummary;
    lines.push('');
    lines.push('## AI Verification');
    lines.push('');
    lines.push(`An AI model (\`${ai.model}\`) double-checked the results:`);
    lines.push('');
    lines.push(`| Result | Count |`);
    lines.push(`| ------ | ----- |`);
    if (ai.confirmedDead) lines.push(`| Confirmed unused | ${ai.confirmedDead} |`);
    if (ai.uncertain) lines.push(`| Needs manual review | ${ai.uncertain} |`);
    if (ai.likelyAlive) lines.push(`| May actually be in use | ${ai.likelyAlive} |`);
    if (ai.falsePositives) lines.push(`| False alarms | ${ai.falsePositives} |`);
    lines.push(`| Files checked | ${ai.filesQualified} |`);
  }

  // Recommended actions
  lines.push('');
  lines.push('## Recommended Actions');
  lines.push('');
  lines.push('1. **Review** the unused files listed above');
  lines.push('2. **Delete** files you confirm are no longer needed');
  lines.push('3. **Automate** with `swynx scan . --fix` (creates a backup you can rollback)');
  lines.push('4. **Prevent** new dead code by adding `swynx scan . --ci` to your build pipeline');

  lines.push('');
  lines.push('---');
  lines.push('*Generated by [Swynx](https://swynx.io)*');
  lines.push('');
  return lines.join('\n');
}
