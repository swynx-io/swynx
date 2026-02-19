/**
 * Console reporter - human-readable coloured output for terminal use.
 */

const ANSI = {
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  reset:  '\x1b[0m',
};

function color(enabled) {
  if (!enabled) {
    // Return an identity object that strips all codes
    return new Proxy({}, { get: () => (s) => s });
  }
  return Object.fromEntries(
    Object.entries(ANSI).map(([k, v]) => [k, (s) => `${v}${s}${ANSI.reset}`]),
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Format a verdict badge for display
 */
function verdictBadge(file, c) {
  const ev = file.evidence;
  if (!ev || !ev.confidence) return '';
  const pct = Math.round(ev.confidence.score * 100);
  const verdict = file.verdict || 'unreachable';
  if (verdict === 'possibly-live') {
    return c.yellow(`  [POSSIBLY LIVE ${pct}%]`);
  }
  if (verdict === 'partially-unreachable') {
    return c.yellow(`  [PARTIAL ${pct}%]`);
  }
  return c.green(`  [UNREACHABLE ${pct}%]`);
}

/**
 * Format evidence summary for a file
 */
function evidenceSummary(file, c) {
  const ev = file.evidence;
  if (!ev) return null;
  const parts = [];
  if (ev.entryPoints) {
    parts.push(`Not reachable from ${ev.entryPoints.total} entry points`);
  }
  if (ev.dynamicCheck?.matchedPattern) {
    parts.push(`Filename matches "${ev.dynamicCheck.matchedPattern}" pattern`);
  } else if (ev.dynamicCheck) {
    parts.push('No dynamic loading pattern');
  }
  return parts.length > 0 ? `     ${c.dim(parts.join('. ') + '.')}` : null;
}

/**
 * @param {object} results
 * @param {object} [options]
 * @returns {string}
 */
export function report(results, options = {}) {
  const useColor = !(options.noColor || process.env.NO_COLOR);
  const c = color(useColor);

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

  // Header
  lines.push('');
  lines.push(c.bold('Swynx Dead Code Report'));
  lines.push('\u2550'.repeat(23));
  lines.push('');

  // Summary
  lines.push(c.bold('Summary'));
  lines.push(`  Total files scanned: ${totalFiles}`);
  lines.push(`  Entry points:        ${entryPoints}`);
  lines.push(`  Reachable files:     ${c.green(String(reachableFiles))}`);
  lines.push(`  Dead files:          ${c.red(`${deadCount} (${deadPct}%)`)}`);
  const dfCount = (results.deadFunctions || []).length;
  if (dfCount > 0) {
    lines.push(`  Dead functions:      ${c.red(String(dfCount))}`);
  }
  lines.push(`  Dead code size:      ${formatBytes(deadBytes)}`);
  lines.push('');

  if (deadCount === 0 && dfCount === 0) {
    lines.push(c.green('No dead code detected. Nice work!'));
    lines.push('');
    return lines.join('\n');
  }

  // Dead files list
  lines.push(c.bold('Dead Files'));
  lines.push('\u2500'.repeat(10));

  deadFiles.forEach((file, i) => {
    const meta = [];
    if (file.size != null) meta.push(formatBytes(file.size));
    if (file.lines != null) meta.push(`${file.lines} lines`);
    const metaStr = meta.length ? ` (${meta.join(', ')})` : '';
    const badge = verdictBadge(file, c);

    lines.push(`  ${c.dim(`${i + 1}.`)} ${c.yellow(file.path)}${c.dim(metaStr)}${badge}`);

    if (file.exports && file.exports.length > 0) {
      lines.push(`     ${c.dim('Exports:')} ${file.exports.join(', ')}`);
    }

    // Evidence summary
    const evLine = evidenceSummary(file, c);
    if (evLine) lines.push(evLine);

    // Verify hint for possibly-live files
    if (file.verdict === 'possibly-live' && file.evidence?.dynamicCheck?.matchedPattern) {
      lines.push(`     ${c.dim('Verify:')} grep -r "${file.evidence.dynamicCheck.matchedPattern}" --include="*.ts"`);
    }

    if (file.aiQualification) {
      const ai = file.aiQualification;
      if (ai.error) {
        lines.push(`     ${c.dim('AI:')} ${c.red(`error: ${ai.error}`)}`);
      } else {
        const pct = Math.round(ai.confidence * 100);
        const confColor = pct >= 80 ? c.red : pct >= 50 ? c.yellow : c.green;
        lines.push(`     ${c.dim('AI:')} ${confColor(`${pct}% dead`)} ${c.dim('·')} ${ai.recommendation}`);
        if (ai.explanation) {
          lines.push(`     ${c.dim(`"${ai.explanation}"`)}`);
        }
      }
    }
  });

  // Dead functions (intra-package unused functions)
  const deadFunctions = results.deadFunctions || [];
  if (deadFunctions.length > 0) {
    lines.push('');
    lines.push(c.bold('Dead Functions'));
    lines.push('\u2500'.repeat(14));

    deadFunctions.forEach((fn, i) => {
      const meta = [];
      if (fn.lineCount) meta.push(`${fn.lineCount} lines`);
      if (fn.sizeBytes) meta.push(formatBytes(fn.sizeBytes));
      const metaStr = meta.length ? ` (${meta.join(', ')})` : '';
      lines.push(`  ${c.dim(`${i + 1}.`)} ${c.yellow(`${fn.file}:${fn.name}`)} ${c.dim(`line ${fn.line}`)}${c.dim(metaStr)}`);
    });
  }

  // AI summary
  if (results.aiSummary) {
    const ai = results.aiSummary;
    lines.push('');
    lines.push(c.bold('AI Qualification') + c.dim(` (${ai.model})`));
    const parts = [];
    if (ai.confirmedDead) parts.push(`${ai.confirmedDead} confirmed dead`);
    if (ai.uncertain) parts.push(`${ai.uncertain} uncertain`);
    if (ai.likelyAlive) parts.push(`${ai.likelyAlive} likely alive`);
    if (ai.falsePositives) parts.push(`${ai.falsePositives} false positive(s)`);
    lines.push(`  ${parts.join(', ')}`);
    lines.push(`  ${c.dim(`${ai.filesQualified} files qualified in ${(ai.duration / 1000).toFixed(1)}s`)}`);
  }

  lines.push('');
  return lines.join('\n');
}
