#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const program = new Command();

program
  .name('swynx')
  .description('Find and remove unused code in your projects')
  .version('0.1.0');

/**
 * Transform raw scanner output into the shape reporters expect.
 */
function toReporterShape(scanResult) {
  const { deadFiles, summary } = scanResult;
  return {
    totalFiles: summary.totalFiles || 0,
    entryPoints: summary.entryPoints || 0,
    reachableFiles: summary.reachableFiles || 0,
    deadRate: summary.deadRate || '0.00%',
    totalDeadBytes: summary.totalDeadBytes || 0,
    languages: summary.languages || {},
    deadFiles: deadFiles.map(f => ({
      path: f.file || f.relativePath || f.path || 'unknown',
      size: f.size || 0,
      lines: f.lines || 0,
      language: f.language || 'unknown',
      exports: (f.exports || []).map(e => typeof e === 'string' ? e : (e.name || 'default')),
      verdict: f.verdict || null,
      cwe: f.cwe || 'CWE-561',
      evidence: f.evidence || null
    })),
    deadFunctions: scanResult.deadFunctions || [],
    unusedExports: (scanResult.partiallyDeadFiles || []).map(f => ({
      file: f.file || f.relativePath,
      language: f.language || 'javascript',
      deadExports: (f.exports || []).filter(e => e.status === 'dead').map(e => ({
        name: e.name,
        line: e.line || 0,
        type: e.type || 'unknown'
      })),
      totalExports: f.summary?.totalExports || (f.exports || []).length,
      liveExports: f.summary?.liveExports || 0,
      evidence: f.evidence || null,
      recommendation: f.recommendation || null
    })).filter(f => f.deadExports.length > 0)
  };
}

// ── scan ────────────────────────────────────────────────────────────────────

program
  .command('scan')
  .argument('[path]', 'project root to scan', '.')
  .description('Scan a project and find unused code')
  .option('--format <type>', 'report format: console, json, markdown, or sarif', 'console')
  .option('--output <file>', 'save the report to a file')
  .option('--ci', 'fail the build if unused code is found (for CI/CD pipelines)')
  .option('--verbose', 'show detailed progress and diagnostics')
  .option('--no-cache', 'force a fresh scan (ignore previous results)')
  .option('--qualify', 'use AI to double-check results (requires Ollama)')
  .option('--model <name>', 'AI model to use for qualification', 'qwen2.5-coder:3b')
  .option('--ollama-url <url>', 'Ollama server address', 'http://localhost:11434')
  .option('--qualify-limit <n>', 'max files to AI-check', (v) => parseInt(v, 10), 50)
  .option('--auto-learn', 'automatically learn from AI false alarms')
  .option('--dry-run', 'preview changes without actually making them')
  .option('--fix', 'delete unused files after scanning (with backup)')
  .option('--min-confidence <n>', 'only fix files above this confidence (0.0-1.0)', (v) => parseFloat(v), 0)
  .option('--no-import-clean', 'skip updating references in other files')
  .option('--no-barrel-clean', 'skip updating index/barrel files')
  .option('--no-git-commit', 'skip creating a git commit after cleanup')
  .option('--include-uncertain', 'also remove files that might still be in use')
  .option('--confirm', 'ask for confirmation before deleting (default with --fix)')
  .action(async (path, opts) => {
    const root = resolve(path);

    const { scanDeadCode } = await import('./scanner/scan-dead-code.mjs');
    const { loadKnowledge } = await import('./knowledge/loader.mjs');

    if (opts.verbose) {
      console.error(`Scanning ${root} ...`);
    }

    const PIPELINE_LABELS = {
      search: '1/7 Search',
      scan: '2/7 Scan',
      analyse: '3/7 Analyse',
      document: '4/7 Document',
      report: '5/7 Report',
      qualify: '6/7 Qualify',
      quantify: '7/7 Quantify',
      done: 'Done'
    };
    const onProgress = ({ phase, message }) => {
      if (opts.verbose && message) {
        const label = PIPELINE_LABELS[phase] || phase;
        console.error(`  [${label}] ${message}`);
      }
    };

    const knowledge = await loadKnowledge();

    const scanResult = await scanDeadCode(root, { onProgress });
    let results = toReporterShape(scanResult);

    // Optional AI qualification
    if (opts.qualify) {
      const { qualify } = await import('./ai/qualifier.mjs');
      results = await qualify(results, { projectPath: root }, {
        model: opts.model,
        ollamaUrl: opts.ollamaUrl,
        qualifyLimit: opts.qualifyLimit,
        autoLearn: opts.autoLearn,
        dryRun: opts.dryRun,
        verbose: opts.verbose,
        knowledge,
      });
    }

    // Pick reporter
    const reporters = {
      console: () => import('./reporters/console.mjs'),
      json: () => import('./reporters/json.mjs'),
      markdown: () => import('./reporters/markdown.mjs'),
      sarif: () => import('./reporters/sarif.mjs'),
    };

    const loader = reporters[opts.format];
    if (!loader) {
      console.error(`Unknown format: ${opts.format}`);
      process.exit(2);
    }

    const reporter = await loader();
    const output = reporter.report(results, {
      noColor: opts.format !== 'console',
      verbose: opts.verbose,
    });

    if (opts.output) {
      writeFileSync(resolve(opts.output), output, 'utf-8');
      console.error(`Report written to ${opts.output}`);
    } else {
      console.log(output);
    }

    if (opts.ci) {
      const fileCount = results.deadFiles.length;
      const fnCount = (results.deadFunctions || []).length;
      const expCount = (results.unusedExports || []).reduce((sum, f) => sum + (f.deadExports || []).length, 0);
      // Unused exports are advisory only — they never fail the build
      if (fileCount + fnCount > 0) {
        console.error(`${fileCount + fnCount} dead code issue${fileCount + fnCount !== 1 ? 's' : ''} found (${fileCount} files, ${fnCount} functions) — build failed (CWE-561)`);
        process.exit(1);
      }
      if (expCount > 0) {
        console.error(`${expCount} unused export${expCount !== 1 ? 's' : ''} found (advisory — not failing the build)`);
      }
    }

    // Apply fix if requested
    if (opts.fix) {
      const { applyFix, generateReport } = await import('./fixer/apply-fix.mjs');

      // Confirm before fixing (unless dry-run)
      if (!opts.dryRun && opts.confirm !== false) {
        const deadCount = results.deadFiles.length;
        if (deadCount === 0) {
          console.log('\nNo unused files to remove.');
          return;
        }

        console.log(`\n${deadCount} unused file${deadCount > 1 ? 's' : ''} will be removed (a backup is created automatically).`);

        const answer = await new Promise((res) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.question('Go ahead? [y/N] ', (ans) => {
            rl.close();
            res(ans.trim().toLowerCase());
          });
        });

        if (answer !== 'y' && answer !== 'yes') {
          console.log('Cancelled — no files were changed.');
          return;
        }
      }

      const fixResult = await applyFix(root, results, {
        dryRun: opts.dryRun,
        minConfidence: opts.minConfidence,
        includeUncertain: opts.includeUncertain || false,
        noImportClean: opts.importClean === false,
        noBarrelClean: opts.barrelClean === false,
        noGitCommit: opts.gitCommit === false,
        verbose: opts.verbose
      });

      const fixReport = generateReport(fixResult, {
        format: opts.format === 'json' ? 'json' : 'console',
        dryRun: opts.dryRun,
        verbose: opts.verbose
      });

      console.log(fixReport);
    }
  });

// ── verify ──────────────────────────────────────────────────────────────────

program
  .command('verify')
  .argument('[path]', 'project root to verify', '.')
  .description('Re-scan and check if previously found issues are fixed')
  .option('--verbose', 'show extra diagnostic output')
  .action(async (path, opts) => {
    const root = resolve(path);

    const { scanDeadCode } = await import('./scanner/scan-dead-code.mjs');
    const { loadKnowledge } = await import('./knowledge/loader.mjs');

    console.error('Running verification scan...');

    await loadKnowledge();

    const onProgress = ({ phase, message }) => {
      if (opts.verbose && message) console.error(`  [${phase}] ${message}`);
    };

    const scanResult = await scanDeadCode(root, { onProgress });
    const results = toReporterShape(scanResult);

    const reporter = await import('./reporters/console.mjs');
    console.log(reporter.report(results, { noColor: false }));
  });

// ── qualify ─────────────────────────────────────────────────────────────────

program
  .command('qualify')
  .argument('<file>', 'scan output JSON file to re-qualify')
  .description('Re-check saved results with AI without re-scanning')
  .option('--format <type>', 'output format (console|json|markdown|sarif)', 'console')
  .option('--output <file>', 'write report to a file instead of stdout')
  .option('--model <name>', 'Ollama model to use', 'qwen2.5-coder:3b')
  .option('--ollama-url <url>', 'Ollama API endpoint', 'http://localhost:11434')
  .option('--qualify-limit <n>', 'max dead files to qualify', (v) => parseInt(v, 10), 50)
  .option('--auto-learn', 'auto-feed AI false positives into knowledge base')
  .option('--dry-run', 'preview what would be learned without writing')
  .option('--verbose', 'show extra diagnostic output')
  .action(async (file, opts) => {
    let results;
    try {
      results = JSON.parse(readFileSync(resolve(file), 'utf8'));
    } catch (err) {
      console.error(`Failed to read scan output: ${err.message}`);
      process.exit(2);
    }

    const { loadKnowledge } = await import('./knowledge/loader.mjs');
    const knowledge = await loadKnowledge();

    const { qualify } = await import('./ai/qualifier.mjs');
    results = await qualify(results, null, {
      model: opts.model,
      ollamaUrl: opts.ollamaUrl,
      qualifyLimit: opts.qualifyLimit,
      autoLearn: opts.autoLearn,
      dryRun: opts.dryRun,
      verbose: opts.verbose,
      knowledge,
    });

    const reporters = {
      console: () => import('./reporters/console.mjs'),
      json: () => import('./reporters/json.mjs'),
      markdown: () => import('./reporters/markdown.mjs'),
      sarif: () => import('./reporters/sarif.mjs'),
    };

    const loader = reporters[opts.format];
    if (!loader) {
      console.error(`Unknown format: ${opts.format}`);
      process.exit(2);
    }

    const reporter = await loader();
    const output = reporter.report(results, {
      noColor: opts.format !== 'console',
      verbose: opts.verbose,
    });

    if (opts.output) {
      writeFileSync(resolve(opts.output), output, 'utf-8');
      console.error(`Report written to ${opts.output}`);
    } else {
      console.log(output);
    }
  });

// ── learn ───────────────────────────────────────────────────────────────────

const learn = program
  .command('learn')
  .description('Manage learned patterns');

learn
  .command('false-positive')
  .argument('<file>', 'file path to mark as a known false positive')
  .description('Mark a file as a false positive so future scans ignore it')
  .action(async (file) => {
    const { recordFalsePositive } = await import('./knowledge/learner.mjs');
    await recordFalsePositive({ file: resolve(file), reason: 'Manual CLI override' });
    console.log(`Marked as false positive: ${file}`);
  });

learn
  .command('show')
  .description('Show all learned patterns')
  .action(async () => {
    const { loadKnowledge, getLearnedFalsePositives, getLearnedPatterns } = await import('./knowledge/loader.mjs');
    await loadKnowledge();
    const fps = getLearnedFalsePositives();
    const patterns = getLearnedPatterns();
    if (fps.length === 0 && patterns.length === 0) {
      console.log('No learned patterns yet.');
      return;
    }
    if (fps.length > 0) {
      console.log('False positives:');
      for (const fp of fps) console.log(`  - ${typeof fp === 'string' ? fp : fp.file || JSON.stringify(fp)}`);
    }
    if (patterns.length > 0) {
      console.log('Learned patterns:');
      for (const p of patterns) console.log(`  - ${p.type}: ${p.pattern || p.value}`);
    }
  });

learn
  .command('reset')
  .description('Clear all learned patterns')
  .action(async () => {
    const { writeFileSync: wfs } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const learnedDir = join(__dirname, 'knowledge', 'learned');
    wfs(join(learnedDir, 'false-positives.json'), '{ "false_positives": [] }\n');
    wfs(join(learnedDir, 'new-patterns.json'), '{ "patterns": [] }\n');
    console.log('All learned patterns have been reset.');
  });

learn
  .command('review')
  .description('Interactively review AI-suggested false positives')
  .action(async () => {
    const { getPendingAI, approvePendingAI, rejectPendingAI } = await import('./knowledge/learner.mjs');
    const pending = getPendingAI();

    if (pending.length === 0) {
      console.log('No pending AI suggestions to review.');
      return;
    }

    console.log(`\n${pending.length} pending AI suggestion(s):\n`);

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((res) => rl.question(q, res));

    for (const item of pending) {
      console.log(`  File: ${item.file}`);
      console.log(`  Reason: ${item.reason}`);
      console.log(`  Confidence: ${Math.round((item.aiConfidence || 0) * 100)}%`);
      console.log(`  Model: ${item.model || 'unknown'}`);

      const answer = await ask('  [a]pprove / [r]eject / [s]kip? ');
      const choice = answer.trim().toLowerCase();

      if (choice === 'a' || choice === 'approve') {
        await approvePendingAI(item.id);
        console.log('  → Approved\n');
      } else if (choice === 'r' || choice === 'reject') {
        await rejectPendingAI(item.id);
        console.log('  → Rejected\n');
      } else {
        console.log('  → Skipped\n');
      }
    }

    rl.close();
    console.log('Review complete.');
  });

// ── rollback ───────────────────────────────────────────────────────────────

program
  .command('rollback')
  .argument('[path]', 'project root', '.')
  .description('Undo the most recent cleanup (restore deleted files)')
  .option('--list', 'show available restore points')
  .option('--snapshot <id>', 'restore a specific backup by ID')
  .action(async (path, opts) => {
    const root = resolve(path);
    const { rollback, listRollbackSnapshots } = await import('./fixer/apply-fix.mjs');

    if (opts.list) {
      const snapshots = await listRollbackSnapshots(root);
      if (snapshots.length === 0) {
        console.log('No restore points available.');
        return;
      }

      console.log('\nAvailable restore points:\n');
      for (const snap of snapshots) {
        const date = new Date(snap.createdAt).toLocaleString();
        const status = snap.status === 'restored' ? ' (already restored)' : '';
        console.log(`  ${snap.snapshotId}${status}`);
        console.log(`    Date:  ${date}`);
        console.log(`    Files: ${snap.fileCount} backed up`);
        console.log('');
      }
      return;
    }

    const result = await rollback(root, opts.snapshot);

    if (result.success) {
      console.log(`\n✓ Restored ${result.restored.length} file${result.restored.length !== 1 ? 's' : ''}`);
      if (result.restored.length > 0 && result.restored.length <= 10) {
        for (const file of result.restored) {
          console.log(`  + ${file}`);
        }
      }
      console.log('\nYour files are back. Run "git checkout ." if you also need to undo the git commit.');
    } else {
      console.error(`\nRestore failed: ${result.error}`);
      process.exit(1);
    }
  });

// ── train ──────────────────────────────────────────────────────────────────

program
  .command('train')
  .description('Regenerate AI training data from scan results')
  .option('--input <dir>', 'directory containing training JSON files', './results/training-data')
  .option('--output <file>', 'output training examples file', './src/knowledge/learned/training-examples.json')
  .action(async (opts) => {
    const trainPath = resolve(import.meta.dirname, 'ai', 'train.mjs');
    const { spawn } = await import('node:child_process');
    const child = spawn('node', [trainPath], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
  });

// ── dashboard ──────────────────────────────────────────────────────────────

program
  .command('dashboard')
  .description('Start the Swynx web dashboard')
  .option('--port <port>', 'port to listen on', '8999')
  .option('--no-browser', 'do not open browser automatically')
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const { startDashboard } = await import('./dashboard/server.mjs');
    await startDashboard({
      port,
      openBrowser: opts.browser !== false
    });
  });

program.parse();
