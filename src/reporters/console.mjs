/**
 * Console reporter - human-readable coloured output for terminal use.
 * Written for business stakeholders, not just developers.
 * Technical detail (CWE-561, exports, etc.) is available but secondary.
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
    return new Proxy({}, { get: () => (s) => s });
  }
  return Object.fromEntries(
    Object.entries(ANSI).map(([k, v]) => [k, (s) => `${v}${s}${ANSI.reset}`]),
  );
}

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

/**
 * Confidence badge — plain English
 */
function verdictBadge(file, c) {
  const ev = file.evidence;
  if (!ev || !ev.confidence || ev.confidence.score == null) return '';
  const pct = Math.round(ev.confidence.score * 100);
  const verdict = file.verdict || 'unreachable';
  if (verdict === 'possibly-live') {
    return c.yellow(`  [NEEDS REVIEW — ${pct}% confidence]`);
  }
  if (verdict === 'partially-unreachable') {
    return c.yellow(`  [PARTIALLY UNUSED — ${pct}% confidence]`);
  }
  return c.dim(`  [${pct}% confidence]`);
}

/**
 * Evidence line — explain WHY in plain language
 */
function evidenceLine(file, c) {
  const ev = file.evidence;
  if (!ev) return null;
  const parts = [];
  if (ev.entryPoints) {
    parts.push(`No code path leads to this file (checked ${ev.entryPoints.total} starting points)`);
  }
  if (ev.dynamicCheck?.matchedPattern) {
    parts.push(`May be loaded at runtime via "${ev.dynamicCheck.matchedPattern}" — worth double-checking`);
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
  const deadPct = totalFiles > 0 ? ((deadCount / totalFiles) * 100).toFixed(1) : '0.0';
  const deadBytes = deadFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const dfCount = (results.deadFunctions || []).length;
  const ueCount = (results.unusedExports || []).reduce((sum, f) => sum + (f.deadExports || []).length, 0);
  const cweCount = deadCount + dfCount + ueCount;
  const activeFiles = reachableFiles || (totalFiles - deadCount);

  const lines = [];

  // Header
  lines.push('');
  lines.push(c.bold('Swynx Dead Code Report'));
  lines.push('\u2550'.repeat(42));
  lines.push('');

  if (cweCount === 0) {
    if (totalFiles === 0) {
      lines.push(c.yellow('No source files found in this directory.'));
    } else {
      lines.push(c.green(`\u2713 All clear — ${totalFiles.toLocaleString()} files scanned, no dead code found.`));
    }
    lines.push('');
    return lines.join('\n');
  }

  // Headline — plain English
  const headlineParts = [];
  if (deadCount > 0) headlineParts.push(`${deadCount} unused file${deadCount !== 1 ? 's' : ''}`);
  if (dfCount > 0) headlineParts.push(`${dfCount} unused function${dfCount !== 1 ? 's' : ''}`);
  if (ueCount > 0) headlineParts.push(`${ueCount} unused export${ueCount !== 1 ? 's' : ''}`);
  lines.push(`  ${c.bold(c.red(`${headlineParts.join(', ')} found`))}`);
  lines.push('');

  // Summary in plain language
  lines.push(c.bold('Summary'));
  lines.push(`  Files scanned:     ${c.cyan(totalFiles.toLocaleString())}`);
  lines.push(`  Active files:      ${c.green(activeFiles.toLocaleString())}`);
  lines.push(`  Unused files:      ${c.red(`${deadCount} (${deadPct}% of your codebase)`)}`);
  if (dfCount > 0) {
    lines.push(`  Unused functions:  ${c.red(String(dfCount))}`);
  }
  if (ueCount > 0) {
    lines.push(`  Unused exports:    ${c.red(String(ueCount))}`);
  }
  lines.push(`  Wasted space:      ${c.red(formatBytes(deadBytes))}`);
  lines.push('');

  // What this means
  lines.push(c.dim('  These files exist in your project but nothing uses them.'));
  lines.push(c.dim('  They add clutter, slow down builds, and increase security surface area.'));
  lines.push(c.dim(`  Ref: CWE-561 — https://cwe.mitre.org/data/definitions/561.html`));
  lines.push('');

  // Findings list
  if (deadCount > 0) {
    lines.push(c.bold('Unused Files'));
    lines.push('\u2500'.repeat(12));
  }

  deadFiles.forEach((file, i) => {
    const meta = [];
    if (file.size != null) meta.push(formatBytes(file.size));
    if (file.lines != null) meta.push(`${file.lines} lines`);
    const metaStr = meta.length ? ` ${c.dim(`(${meta.join(', ')})`)}` : '';
    const badge = verdictBadge(file, c);

    lines.push(`  ${c.dim(`${i + 1}.`)} ${c.yellow(file.path)}${metaStr}${badge}`);

    // Evidence — why we think it's unused
    const ev = evidenceLine(file, c);
    if (ev) lines.push(ev);

    // Verify hint for possibly-live files
    if (file.verdict === 'possibly-live') {
      lines.push(`     ${c.dim('Action: Check if this file is loaded dynamically before deleting.')}`);
    }

    if (file.aiQualification) {
      const ai = file.aiQualification;
      if (ai.error) {
        lines.push(`     ${c.dim('AI check:')} ${c.red(`error: ${ai.error}`)}`);
      } else {
        const pct = Math.round(ai.confidence * 100);
        const confColor = pct >= 80 ? c.red : pct >= 50 ? c.yellow : c.green;
        lines.push(`     ${c.dim('AI verdict:')} ${confColor(`${pct}% likely unused`)} — ${ai.recommendation}`);
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
    lines.push(c.bold('Unused Functions'));
    lines.push('\u2500'.repeat(16));
    lines.push(c.dim('  These functions exist but are never called anywhere.'));
    lines.push('');

    deadFunctions.forEach((fn, i) => {
      const meta = [];
      if (fn.lineCount) meta.push(`${fn.lineCount} lines`);
      if (fn.sizeBytes) meta.push(formatBytes(fn.sizeBytes));
      const metaStr = meta.length ? ` ${c.dim(`(${meta.join(', ')})`)}` : '';
      lines.push(`  ${c.dim(`${i + 1}.`)} ${c.yellow(`${fn.file}:`)}${c.bold(fn.name)} ${c.dim(`line ${fn.line}`)}${metaStr}`);
    });
  }

  // Unused exports (file is alive, but some of its exports are never imported)
  const unusedExports = results.unusedExports || [];
  if (unusedExports.length > 0) {
    lines.push('');
    lines.push(c.bold('Unused Exports'));
    lines.push('─'.repeat(14));
    lines.push(c.dim('  These files are in use, but some of their exports are never imported anywhere.'));
    lines.push('');

    let ueIdx = 0;
    for (const entry of unusedExports) {
      for (const exp of entry.deadExports) {
        ueIdx++;
        lines.push(`  ${c.dim(`${ueIdx}.`)} ${c.yellow(`${entry.file}:`)}${c.bold(exp.name)} ${c.dim(`line ${exp.line}`)}`);
      }
    }
  }

  // AI summary
  if (results.aiSummary) {
    const ai = results.aiSummary;
    lines.push('');
    lines.push(c.bold('AI Verification') + c.dim(` (${ai.model})`));
    const parts = [];
    if (ai.confirmedDead) parts.push(`${ai.confirmedDead} confirmed unused`);
    if (ai.uncertain) parts.push(`${ai.uncertain} need manual review`);
    if (ai.likelyAlive) parts.push(`${ai.likelyAlive} may actually be in use`);
    if (ai.falsePositives) parts.push(`${ai.falsePositives} false alarm(s)`);
    lines.push(`  ${parts.join(', ')}`);
    lines.push(`  ${c.dim(`${ai.filesQualified} files checked in ${(ai.duration / 1000).toFixed(1)}s`)}`);
  }

  // What to do next
  lines.push('');
  lines.push(c.bold('What to do'));
  lines.push(`  ${c.dim('Review the files above and delete what you don\'t need.')}`);
  lines.push(`  ${c.dim('Run')} swynx scan . --fix ${c.dim('to automatically remove them (with rollback).')}`);
  lines.push(`  ${c.dim('Run')} swynx scan . --fix --dry-run ${c.dim('to preview what would be removed.')}`);

  lines.push('');
  return lines.join('\n');
}
