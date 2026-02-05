#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const program = new Command();

program
  .name('swynx')
  .description('Dead code detection powered by knowledge patterns')
  .version('0.1.0');

/**
 * Transform raw scanner output into the shape reporters expect.
 */
function toReporterShape(scanResult) {
  const { deadFiles, summary } = scanResult;
  return {
    totalFiles: summary.totalFiles,
    entryPoints: summary.entryPoints,
    reachableFiles: summary.reachableFiles,
    deadRate: summary.deadRate,
    totalDeadBytes: summary.totalDeadBytes,
    languages: summary.languages,
    deadFiles: deadFiles.map(f => ({
      path: f.file,
      size: f.size,
      lines: f.lines,
      language: f.language,
      exports: (f.exports || []).map(e => e.name)
    }))
  };
}

// ── scan ────────────────────────────────────────────────────────────────────

program
  .command('scan')
  .argument('[path]', 'project root to scan', '.')
  .description('Scan a project for dead code')
  .option('--format <type>', 'output format (console|json|markdown|sarif)', 'console')
  .option('--output <file>', 'write report to a file instead of stdout')
  .option('--ci', 'exit with code 1 when dead code is found')
  .option('--verbose', 'show extra diagnostic output')
  .option('--no-cache', 'ignore cached scan data')
  .option('--qualify', 'run AI qualification on dead files via Ollama')
  .option('--model <name>', 'Ollama model to use', 'qwen2.5-coder:3b')
  .option('--ollama-url <url>', 'Ollama API endpoint', 'http://localhost:11434')
  .option('--qualify-limit <n>', 'max dead files to qualify', (v) => parseInt(v, 10), 50)
  .option('--auto-learn', 'auto-feed AI false positives into knowledge base')
  .option('--dry-run', 'preview what would be learned without writing')
  .action(async (path, opts) => {
    const root = resolve(path);

    const { scan } = await import('./scanner/index.mjs');
    const { loadKnowledge } = await import('./knowledge/loader.mjs');

    if (opts.verbose) {
      console.error(`Scanning ${root} ...`);
    }

    const onProgress = ({ phase, message }) => {
      if (opts.verbose && message) console.error(`  [${phase}] ${message}`);
    };

    const knowledge = await loadKnowledge();

    const scanResult = await scan(root, { onProgress });
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

    if (opts.ci && results.deadFiles.length > 0) {
      process.exit(1);
    }
  });

// ── verify ──────────────────────────────────────────────────────────────────

program
  .command('verify')
  .argument('[path]', 'project root to verify', '.')
  .description('Re-scan a project and compare with previous results')
  .option('--verbose', 'show extra diagnostic output')
  .action(async (path, opts) => {
    const root = resolve(path);

    const { scan } = await import('./scanner/index.mjs');
    const { loadKnowledge } = await import('./knowledge/loader.mjs');

    console.error('Running verification scan...');

    await loadKnowledge();

    const onProgress = ({ phase, message }) => {
      if (opts.verbose && message) console.error(`  [${phase}] ${message}`);
    };

    const scanResult = await scan(root, { onProgress });
    const results = toReporterShape(scanResult);

    const reporter = await import('./reporters/console.mjs');
    console.log(reporter.report(results, { noColor: false }));
  });

// ── qualify ─────────────────────────────────────────────────────────────────

program
  .command('qualify')
  .argument('<file>', 'scan output JSON file to re-qualify')
  .description('Re-qualify saved scan results without re-scanning')
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
