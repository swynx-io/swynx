/**
 * Console reporter - human-readable coloured output for terminal use.
 * Frames all output as CWE-561 security findings.
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
  const dfCount = (results.deadFunctions || []).length;
  const cweCount = deadCount + dfCount;

  const lines = [];

  // Header — CWE-561 is the headline
  lines.push('');
  lines.push(c.bold('Swynx Security Report') + c.dim(' — CWE-561 Dead Code'));
  lines.push('\u2550'.repeat(42));
  lines.push('');

  if (cweCount === 0) {
    lines.push(c.green(`\u2713 No CWE-561 instances found across ${totalFiles} files. Clean.`));
    lines.push('');
    return lines.join('\n');
  }

  // Headline finding
  lines.push(`  ${c.bold(c.red(`${cweCount} CWE-561 instance${cweCount !== 1 ? 's' : ''}`))} found across ${totalFiles} files`);
  lines.push('');

  // Breakdown
  lines.push(c.bold('Breakdown'));
  lines.push(`  Unreachable files:   ${c.red(`${deadCount} (${deadPct}% of codebase)`)}`);
  if (dfCount > 0) {
    lines.push(`  Unreachable functions: ${c.red(String(dfCount))}`);
  }
  lines.push(`  Dead code size:      ${formatBytes(deadBytes)}`);
  lines.push(`  Entry points tested: ${entryPoints}`);
  lines.push(`  Reachable files:     ${c.green(String(reachableFiles))}`);
  lines.push('');

  // CWE reference
  lines.push(c.dim('  CWE-561: "The product contains dead code, which can never be executed."'));
  lines.push(c.dim('  https://cwe.mitre.org/data/definitions/561.html'));
  lines.push('');

  // Dead files list
  lines.push(c.bold('Findings'));
  lines.push('\u2500'.repeat(8));

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
        lines.push(`     ${c.dim('AI:')} ${confColor(`${pct}% dead`)} ${c.dim('\u00b7')} ${ai.recommendation}`);
        if (ai.explanation) {
          lines.push(`     ${c.dim(`"${ai.explanation}"`)}`);
        }
      }
    }
  });

  // Dead functions
  const deadFunctions = results.deadFunctions || [];
  if (deadFunctions.length > 0) {
    lines.push('');
    lines.push(c.bold('Unreachable Functions'));
    lines.push('\u2500'.repeat(20));

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
