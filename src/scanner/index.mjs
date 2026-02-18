// src/scanner/index.mjs
// Main project scanner with comprehensive progress reporting

import { randomUUID } from 'crypto';
import { availableParallelism } from 'os';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { discoverFiles, categoriseFiles, getTotalSize } from './discovery.mjs';
import { parseJavaScript } from './parsers/javascript.mjs';
import { parseCSS } from './parsers/css.mjs';
import { analyseAssets } from './parsers/assets.mjs';
import { parseFile } from './parsers/registry.mjs';
import { analyseDependencies, checkHeavyDependencies, enrichUnusedDependency } from './analysers/dependencies.mjs';
import { analyseImports } from './analysers/imports.mjs';
import { findDeadCode, calculateDeadCodeSize, enrichDeadCodeFile } from './analysers/deadcode.mjs';
import { findDuplicates, calculateDuplicateSize } from './analysers/duplicates.mjs';
import { analyseBundles } from './analysers/bundles.mjs';
import { analyseAssetOptimisation, findUnusedAssets, enrichUnusedAsset, analyseAssetsFullDepth } from './analysers/assets.mjs';
import { calculateEmissions } from '../emissions/index.mjs';
import { applyRules } from '../rules/index.mjs';
import { scanSecurityVulnerabilities, enrichVulnerability } from './analysers/security.mjs';
import { scanCodePatterns, enrichDeadFileWithPatterns } from '../security/scanner.mjs';
import { scanLicenses } from './analysers/licenses.mjs';
import { scanOutdatedDependencies } from './analysers/outdated.mjs';
import { analyseLogFiles } from './analysers/logs.mjs';
import { calculateCosts } from '../calculator/cost.mjs';
import { calculateHealthScore } from '../calculator/score.mjs';
import { getSettings } from '../config/store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKER_PATH = join(__dirname, 'parse-worker.mjs');
const DEFAULT_WORKER_COUNT = parseInt(process.env.SWYNX_WORKERS || '0') || Math.min(availableParallelism(), 8);

/**
 * Parse files in parallel using worker threads
 * Falls back to sequential parsing if workerCount is 1 or files are few
 */
function parallelParse(files, parserType, onFileProgress, configWorkers) {
  const maxWorkers = configWorkers || DEFAULT_WORKER_COUNT;
  const workerCount = Math.min(maxWorkers, Math.ceil(files.length / 50));

  if (workerCount <= 1 || files.length < 100) {
    // Not worth the overhead - fall back to sequential
    return null;
  }

  return new Promise((resolve, reject) => {
    const chunkSize = Math.ceil(files.length / workerCount);
    let completed = 0;
    let progressTotal = 0;
    const allResults = [];

    console.error(`[PARALLEL] Splitting ${files.length} files across ${workerCount} workers`);

    for (let i = 0; i < workerCount; i++) {
      const chunk = files.slice(i * chunkSize, (i + 1) * chunkSize);
      if (chunk.length === 0) continue;

      const worker = new Worker(WORKER_PATH, {
        workerData: { files: chunk, parserType }
      });

      worker.on('message', (msg) => {
        if (msg.type === 'progress') {
          progressTotal += msg.done - (worker._lastProgress || 0);
          worker._lastProgress = msg.done;
          if (onFileProgress) onFileProgress(progressTotal);
        } else if (msg.type === 'batch') {
          // B1: Handle batch messages from worker (intermediate results)
          allResults.push(...msg.results);
        } else if (msg.type === 'done') {
          allResults.push(...msg.results);
          completed++;
          if (completed === workerCount) {
            resolve(allResults);
          }
        } else if (msg.type === 'error') {
          console.error(`[PARALLEL] Worker error: ${msg.message}`);
          completed++;
          if (completed === workerCount) {
            resolve(allResults);
          }
        }
      });

      worker.on('error', (err) => {
        console.error(`[PARALLEL] Worker crashed: ${err.message}`);
        completed++;
        if (completed === workerCount) {
          resolve(allResults);
        }
      });
    }
  });
}

/**
 * Progress phases with their weight (percentage of total scan time)
 */
const SCAN_PHASES = {
  DISCOVERY: { name: 'Discovering files', weight: 5 },
  PARSE_JS: { name: 'Parsing JavaScript/TypeScript', weight: 12 },
  PARSE_OTHER: { name: 'Parsing other languages', weight: 8 },
  PARSE_CSS: { name: 'Parsing CSS', weight: 3 },
  PARSE_ASSETS: { name: 'Analysing assets', weight: 4 },
  DEPENDENCIES: { name: 'Analysing dependencies', weight: 10 },
  IMPORT_GRAPH: { name: 'Building import graph', weight: 10 },
  DEAD_CODE: { name: 'Detecting dead code', weight: 10 },
  CODE_PATTERNS: { name: 'Scanning dead code patterns', weight: 3 },
  DUPLICATES: { name: 'Finding duplicate code', weight: 7 },
  SECURITY: { name: 'Scanning security vulnerabilities', weight: 8 },
  LICENSES: { name: 'Checking license compliance', weight: 5 },
  OUTDATED: { name: 'Checking outdated packages', weight: 5 },
  BUNDLES: { name: 'Analysing build output', weight: 5 },
  EMISSIONS: { name: 'Calculating environmental impact', weight: 3 },
  FINALIZING: { name: 'Finalizing results', weight: 2 }
};

/**
 * Default progress reporter (console output)
 */
function defaultProgressReporter(progress) {
  const { phase, percent, detail, current, total } = progress;
  const bar = createProgressBar(percent, 30);
  const countStr = total ? ` (${current}/${total})` : '';
  const detailStr = detail ? ` - ${detail}` : '';

  process.stdout.write(`\r${bar} ${percent.toFixed(0)}% | ${phase}${countStr}${detailStr}`.padEnd(100));

  if (percent >= 100) {
    process.stdout.write('\n');
  }
}

/**
 * Create ASCII progress bar
 */
function createProgressBar(percent, width) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Main project scanner with deep data collection and progress reporting
 */
export async function scanProject(projectPath, config = {}) {
  const startTime = Date.now();
  const onProgress = config.onProgress || defaultProgressReporter;

  // Read feature flags from settings
  const settings = getSettings();
  const features = settings.features || {};

  let basePercent = 0;

  const reportPhase = (phaseName, detail = '', current = 0, total = 0) => {
    onProgress({
      phase: phaseName,
      percent: Math.min(basePercent, 100),
      detail: detail.length > 50 ? '...' + detail.slice(-47) : detail,
      current,
      total
    });
  };

  const advancePhase = (phaseKey) => {
    basePercent += SCAN_PHASES[phaseKey].weight;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: File Discovery
  // ═══════════════════════════════════════════════════════════════════════════
  console.error('[STAGE] Starting file discovery...');
  reportPhase(SCAN_PHASES.DISCOVERY.name, 'Scanning directory structure...');

  const files = await discoverFiles(projectPath, {
    include: config.include,
    exclude: config.exclude,
    onProgress: ({ current, total, file }) => {
      // Report discovery progress incrementally
      const discoveryProgress = (current / Math.max(total, 1)) * SCAN_PHASES.DISCOVERY.weight;
      basePercent = discoveryProgress;
      reportPhase(SCAN_PHASES.DISCOVERY.name, file, current, total);
    }
  });

  const categorised = categoriseFiles(files);
  advancePhase('DISCOVERY');
  reportPhase(SCAN_PHASES.DISCOVERY.name, `Found ${files.length} files`);
  console.error(`[STAGE] File discovery complete - ${files.length} files`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Parse JavaScript/TypeScript
  // ═══════════════════════════════════════════════════════════════════════════
  console.error(`[STAGE] Parsing ${categorised.javascript.length} JS/TS files...`);
  const jsFiles = categorised.javascript;
  let jsAnalysis;

  const jsParallel = parallelParse(jsFiles, 'javascript', (done) => {
    const phaseProgress = (done / jsFiles.length) * SCAN_PHASES.PARSE_JS.weight;
    basePercent = SCAN_PHASES.DISCOVERY.weight + phaseProgress;
    reportPhase(SCAN_PHASES.PARSE_JS.name, `${done}/${jsFiles.length} files`, done, jsFiles.length);
  }, config.workers);

  if (jsParallel) {
    jsAnalysis = await jsParallel;
  } else {
    jsAnalysis = [];
    for (let i = 0; i < jsFiles.length; i++) {
      const file = jsFiles[i];
      const fileName = file.relativePath || file.path || file;
      reportPhase(SCAN_PHASES.PARSE_JS.name, fileName, i + 1, jsFiles.length);

      const parsed = await parseJavaScript(file);
      jsAnalysis.push(parsed);

      const phaseProgress = ((i + 1) / jsFiles.length) * SCAN_PHASES.PARSE_JS.weight;
      basePercent = SCAN_PHASES.DISCOVERY.weight + phaseProgress;

      if (i % 2 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  }
  advancePhase('PARSE_JS');
  console.error(`[STAGE] JS parsing complete`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2.5: Parse Other Languages (Python, Java, Kotlin, C#, Go, Rust)
  // ═══════════════════════════════════════════════════════════════════════════
  const otherLangFiles = [
    ...categorised.python || [],
    ...categorised.java || [],
    ...categorised.kotlin || [],
    ...categorised.csharp || [],
    ...categorised.go || [],
    ...categorised.rust || []
  ];
  const otherLangAnalysis = [];

  if (otherLangFiles.length > 0) {
    console.error(`[STAGE] Parsing ${otherLangFiles.length} other language files...`);

    const otherParallel = parallelParse(otherLangFiles, 'other', (done) => {
      const prevPhases = SCAN_PHASES.DISCOVERY.weight + SCAN_PHASES.PARSE_JS.weight;
      const phaseProgress = (done / otherLangFiles.length) * SCAN_PHASES.PARSE_OTHER.weight;
      basePercent = prevPhases + phaseProgress;
      reportPhase(SCAN_PHASES.PARSE_OTHER.name, `${done}/${otherLangFiles.length} files`, done, otherLangFiles.length);
    }, config.workers);

    if (otherParallel) {
      otherLangAnalysis.push(...await otherParallel);
    } else {
      for (let i = 0; i < otherLangFiles.length; i++) {
        const file = otherLangFiles[i];
        const fileName = file.relativePath || file.path || file;
        reportPhase(SCAN_PHASES.PARSE_OTHER.name, fileName, i + 1, otherLangFiles.length);

        try {
          const parsed = await parseFile(file);
          if (parsed) {
            otherLangAnalysis.push(parsed);
          }
        } catch (e) {
          console.error(`[WARN] Failed to parse ${fileName}: ${e.message}`);
        }

        if (i % 2 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    }
    console.error(`[STAGE] Other language parsing complete - ${otherLangAnalysis.length} files`);
  }
  advancePhase('PARSE_OTHER');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: Parse CSS
  // ═══════════════════════════════════════════════════════════════════════════
  const cssFiles = categorised.css;
  let cssAnalysis = [];

  if (features.cssAnalysis !== false) {
    console.error(`[STAGE] Parsing ${cssFiles.length} CSS files...`);

    const cssParallel = parallelParse(cssFiles, 'css', (done) => {
      const prevPhases = SCAN_PHASES.DISCOVERY.weight + SCAN_PHASES.PARSE_JS.weight + SCAN_PHASES.PARSE_OTHER.weight;
      const phaseProgress = (done / cssFiles.length) * SCAN_PHASES.PARSE_CSS.weight;
      basePercent = prevPhases + phaseProgress;
      reportPhase(SCAN_PHASES.PARSE_CSS.name, `${done}/${cssFiles.length} files`, done, cssFiles.length);
    }, config.workers);

    if (cssParallel) {
      cssAnalysis = await cssParallel;
    } else {
      for (let i = 0; i < cssFiles.length; i++) {
        const file = cssFiles[i];
        const fileName = file.relativePath || file.path || file;
        reportPhase(SCAN_PHASES.PARSE_CSS.name, fileName, i + 1, cssFiles.length);

        const parsed = await parseCSS(file);
        cssAnalysis.push(parsed);

        if (i % 2 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    }
    console.error(`[STAGE] CSS parsing complete`);
  } else {
    console.error('[STAGE] CSS parsing skipped (feature disabled)');
  }
  advancePhase('PARSE_CSS');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: Analyse Assets
  // ═══════════════════════════════════════════════════════════════════════════
  const assetFiles = categorised.assets;
  let assetAnalysis = [];

  if (features.assets !== false) {
    console.error(`[STAGE] Analysing ${assetFiles.length} assets...`);

    const assetParallel = parallelParse(assetFiles, 'assets', (done) => {
      const prevPhases = SCAN_PHASES.DISCOVERY.weight + SCAN_PHASES.PARSE_JS.weight +
        SCAN_PHASES.PARSE_OTHER.weight + SCAN_PHASES.PARSE_CSS.weight;
      const phaseProgress = (done / assetFiles.length) * SCAN_PHASES.PARSE_ASSETS.weight;
      basePercent = prevPhases + phaseProgress;
      reportPhase(SCAN_PHASES.PARSE_ASSETS.name, `${done}/${assetFiles.length} files`, done, assetFiles.length);
    }, config.workers);

    if (assetParallel) {
      assetAnalysis = await assetParallel;
    } else {
      for (let i = 0; i < assetFiles.length; i++) {
        const file = assetFiles[i];
        const fileName = file.relativePath || file.path || file;
        reportPhase(SCAN_PHASES.PARSE_ASSETS.name, fileName, i + 1, assetFiles.length);

        const parsed = await analyseAssets(file);
        assetAnalysis.push(parsed);

        if (i % 2 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    }
    console.error(`[STAGE] Asset parsing complete`);
  } else {
    console.error('[STAGE] Asset parsing skipped (feature disabled)');
  }
  advancePhase('PARSE_ASSETS');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5: Dependency Analysis
  // ═══════════════════════════════════════════════════════════════════════════
  console.error('[STAGE] Analysing dependencies...');
  reportPhase(SCAN_PHASES.DEPENDENCIES.name, 'Reading package.json and node_modules...');
  const dependencies = await analyseDependencies(projectPath);
  advancePhase('DEPENDENCIES');
  reportPhase(SCAN_PHASES.DEPENDENCIES.name, `Found ${dependencies.length} dependencies`);
  console.error(`[STAGE] Dependency analysis complete - ${dependencies.length} deps`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 6: Import Graph Analysis
  // ═══════════════════════════════════════════════════════════════════════════
  console.error('[STAGE] Building import graph...');
  reportPhase(SCAN_PHASES.IMPORT_GRAPH.name, 'Tracing imports and exports...');
  const importGraph = await analyseImports(jsAnalysis, ({ current, total, file }) => {
    const fileName = typeof file === 'string' ? file.split('/').pop() : file;
    reportPhase(SCAN_PHASES.IMPORT_GRAPH.name, fileName, current, total);
  });

  // Read package.json for entry point detection
  let packageJson = {};
  try {
    const pkgPath = `${projectPath}/package.json`;
    const { readFileSync } = await import('fs');
    packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    // No package.json or invalid JSON
  }
  advancePhase('IMPORT_GRAPH');
  console.error('[STAGE] Import graph complete');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 7: Dead Code Detection
  // ═══════════════════════════════════════════════════════════════════════════
  console.error('[STAGE] Detecting dead code...');
  reportPhase(SCAN_PHASES.DEAD_CODE.name, 'Analysing code reachability...');

  // Pass dynamic patterns config to dead code detector
  const deadCodeConfig = {
    dynamicPatterns: config.deadCode?.dynamicPatterns || []
  };

  // Combine JS and other language analysis for dead code detection
  const allCodeAnalysis = [...jsAnalysis, ...otherLangAnalysis];

  const deadCode = await findDeadCode(allCodeAnalysis, importGraph, projectPath, packageJson, deadCodeConfig, ({ current, total, file }) => {
    const fileName = typeof file === 'string' ? file.split('/').pop() : file;
    reportPhase(SCAN_PHASES.DEAD_CODE.name, fileName, current, total);
  });
  advancePhase('DEAD_CODE');

  const deadFileCount = (deadCode.fullyDeadFiles?.length || 0) + (deadCode.partiallyDeadFiles?.length || 0);
  reportPhase(SCAN_PHASES.DEAD_CODE.name, `Found ${deadFileCount} files with dead code`);
  console.error(`[STAGE] Dead code detection complete - ${deadFileCount} files with dead code`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 7.5: Full Codebase Security Pattern Scan
  // ═══════════════════════════════════════════════════════════════════════════
  console.error('[STAGE] Scanning all files for security patterns...');
  reportPhase(SCAN_PHASES.CODE_PATTERNS.name, 'Checking CWE patterns across all files...');

  // Build dead file set for isDead flagging
  const deadFileSet = new Set([
    ...(deadCode.fullyDeadFiles || []).map(f => f.relativePath || f.file || f.path || ''),
    ...(deadCode.partiallyDeadFiles || []).map(f => f.relativePath || f.file || f.path || '')
  ]);

  const codePatterns = scanCodePatterns(allCodeAnalysis, deadFileSet, projectPath, ({ detail, current, total }) => {
    reportPhase(SCAN_PHASES.CODE_PATTERNS.name, detail, current, total);
  });

  // Enrich dead files with per-file security pattern data
  if (codePatterns.summary.totalFindings > 0) {
    if (deadCode.fullyDeadFiles) {
      deadCode.fullyDeadFiles = deadCode.fullyDeadFiles.map(f => enrichDeadFileWithPatterns(f, codePatterns.byFile));
    }
    if (deadCode.partiallyDeadFiles) {
      deadCode.partiallyDeadFiles = deadCode.partiallyDeadFiles.map(f => enrichDeadFileWithPatterns(f, codePatterns.byFile));
    }
  }

  advancePhase('CODE_PATTERNS');
  const cpSum = codePatterns.summary;
  reportPhase(SCAN_PHASES.CODE_PATTERNS.name, `Found ${cpSum.total} security patterns (${cpSum.inLiveCode} live, ${cpSum.inDeadCode} dead)`);
  console.error(`[STAGE] Code pattern scan complete - ${cpSum.total} patterns (${cpSum.inLiveCode} live, ${cpSum.inDeadCode} dead)`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 8: Duplicate Detection
  // ═══════════════════════════════════════════════════════════════════════════
  let duplicates = { duplicateFunctions: [], similarBlocks: [] };

  if (features.duplicates !== false) {
    console.error('[STAGE] Finding duplicate functions...');
    reportPhase(SCAN_PHASES.DUPLICATES.name, 'Comparing function bodies for duplicates...');
    duplicates = await findDuplicates(jsAnalysis, ({ current, total, file }) => {
      const fileName = typeof file === 'string' ? file.split('/').pop() : file;
      reportPhase(SCAN_PHASES.DUPLICATES.name, fileName, current, total);
    });
    reportPhase(SCAN_PHASES.DUPLICATES.name, `Found ${duplicates.duplicateFunctions.length} duplicate functions`);
    console.error(`[STAGE] Duplicate detection complete - ${duplicates.duplicateFunctions.length} duplicates`);
  } else {
    console.error('[STAGE] Duplicate detection skipped (feature disabled)');
  }
  advancePhase('DUPLICATES');

  // Find and enrich unused dependencies
  console.error('[STAGE] Analysing unused dependencies...');
  reportPhase(SCAN_PHASES.DUPLICATES.name, 'Analysing unused dependencies...');
  const unusedDepsRaw = dependencies.filter(d =>
    d.declaredIn === 'dependencies' && !importGraph.usedPackages.has(d.name)
  );

  const unusedDeps = unusedDepsRaw.map((dep, i) => {
    reportPhase(SCAN_PHASES.DUPLICATES.name, `Enriching ${dep.name}`, i + 1, unusedDepsRaw.length);
    return enrichUnusedDependency(dep, projectPath, importGraph, jsAnalysis);
  });

  const heavyDeps = checkHeavyDependencies(dependencies);
  console.error(`[STAGE] Unused dependency analysis complete - ${unusedDeps.length} unused`);

  // Asset analysis - report progress to dashboard
  let assetsFullDepth = { assets: [], summary: {} };
  let assetOptimisation = { potentialSavings: 0, opportunities: [] };
  let unusedAssets = [];

  if (features.assets !== false) {
    reportPhase(SCAN_PHASES.DUPLICATES.name, 'Deep asset analysis...');
    console.error('[STAGE] Starting deep asset analysis...');
    assetsFullDepth = await analyseAssetsFullDepth(assetAnalysis, jsAnalysis, cssAnalysis, projectPath, config, (detail, current, total) => {
      reportPhase(SCAN_PHASES.DUPLICATES.name, detail, current, total);
    });

    reportPhase(SCAN_PHASES.DUPLICATES.name, 'Checking asset optimisation opportunities...');
    console.error('[STAGE] Asset optimisation analysis...');
    assetOptimisation = analyseAssetOptimisation(assetAnalysis, projectPath);

    reportPhase(SCAN_PHASES.DUPLICATES.name, 'Finding unused assets...');
    console.error('[STAGE] Finding unused assets...');
    const unusedAssetsRaw = findUnusedAssets(assetAnalysis, jsAnalysis, cssAnalysis, projectPath);

    reportPhase(SCAN_PHASES.DUPLICATES.name, `Analysing ${unusedAssetsRaw.length} unused assets...`);
    console.error(`[STAGE] Enriching ${unusedAssetsRaw.length} unused assets...`);

    const skipGitHistory = unusedAssetsRaw.length > 50;
    if (skipGitHistory) {
      console.error(`[PERF] Skipping git history for ${unusedAssetsRaw.length} unused assets (> 50 limit)`);
    }

    unusedAssets = unusedAssetsRaw.map((asset, i) => {
      if (i % 20 === 0 || i === unusedAssetsRaw.length - 1) {
        reportPhase(SCAN_PHASES.DUPLICATES.name, `Enriching unused asset ${i + 1}/${unusedAssetsRaw.length}`, i + 1, unusedAssetsRaw.length);
        console.error(`[STAGE] Enriching unused asset ${i + 1}/${unusedAssetsRaw.length}...`);
      }
      return enrichUnusedAsset(asset, skipGitHistory ? null : projectPath, jsAnalysis, cssAnalysis);
    });

    reportPhase(SCAN_PHASES.DUPLICATES.name, `Found ${unusedAssets.length} unused assets`);
    console.error('[STAGE] Asset analysis complete');
  } else {
    console.error('[STAGE] Asset analysis skipped (feature disabled)');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 9: Security Vulnerability Scan
  // ═══════════════════════════════════════════════════════════════════════════
  console.error('[STAGE] Starting security scan...');
  reportPhase(SCAN_PHASES.SECURITY.name, 'Running npm audit...');
  const securityRaw = await scanSecurityVulnerabilities(dependencies, projectPath, jsAnalysis);

  // Enrich each vulnerability with usage analysis
  const vulnCount = securityRaw.vulnerabilities.length;
  const enrichedVulns = [];

  for (let i = 0; i < securityRaw.vulnerabilities.length; i++) {
    const vuln = securityRaw.vulnerabilities[i];
    reportPhase(SCAN_PHASES.SECURITY.name, `Analysing ${vuln.package}`, i + 1, vulnCount);
    enrichedVulns.push(enrichVulnerability(vuln, projectPath, jsAnalysis));
  }

  const security = {
    ...securityRaw,
    vulnerabilities: enrichedVulns,
    critical: securityRaw.critical.map(v => enrichVulnerability(v, projectPath, jsAnalysis)),
    high: securityRaw.high.map(v => enrichVulnerability(v, projectPath, jsAnalysis)),
    medium: securityRaw.medium.map(v => enrichVulnerability(v, projectPath, jsAnalysis)),
    low: securityRaw.low.map(v => enrichVulnerability(v, projectPath, jsAnalysis)),
  };
  advancePhase('SECURITY');

  console.error('[STAGE] Security scan complete');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 10: License Compliance
  // ═══════════════════════════════════════════════════════════════════════════
  let licenses = { byLicense: {}, packages: [], risks: [] };

  if (features.licenses !== false) {
    console.error('[STAGE] Checking license compliance...');
    reportPhase(SCAN_PHASES.LICENSES.name, 'Checking license compliance...');
    licenses = await scanLicenses(dependencies, projectPath);
    console.error('[STAGE] License check complete');
  } else {
    console.error('[STAGE] License check skipped (feature disabled)');
  }
  advancePhase('LICENSES');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 11: Outdated Dependencies
  // ═══════════════════════════════════════════════════════════════════════════
  console.error('[STAGE] Checking for outdated dependencies...');
  reportPhase(SCAN_PHASES.OUTDATED.name, 'Checking for outdated packages...');
  const outdated = await scanOutdatedDependencies(dependencies, projectPath, {
    onProgress: (detail, current, total) => {
      const phaseProgress = (current / Math.max(total, 1)) * SCAN_PHASES.OUTDATED.weight;
      reportPhase(SCAN_PHASES.OUTDATED.name, detail, current, total);
    }
  });
  advancePhase('OUTDATED');
  reportPhase(SCAN_PHASES.OUTDATED.name, `Found ${outdated.totalOutdated || 0} outdated packages`);
  console.error(`[STAGE] Outdated check complete - ${outdated.totalOutdated || 0} outdated`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 12: Bundle Analysis
  // ═══════════════════════════════════════════════════════════════════════════
  let bundles = { totalSize: 0, files: [] };

  if (features.bundles !== false) {
    console.error('[STAGE] Analysing build output...');
    reportPhase(SCAN_PHASES.BUNDLES.name, 'Analysing build output...');
    bundles = await analyseBundles(projectPath, config);
    console.error('[STAGE] Bundle analysis complete');
  } else {
    console.error('[STAGE] Bundle analysis skipped (feature disabled)');
  }
  advancePhase('BUNDLES');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 12.5: Log File Analysis
  // ═══════════════════════════════════════════════════════════════════════════
  let logAnalysis = { hasIssues: false, findings: [], summary: {} };

  if (features.buildLogs !== false) {
    console.error('[STAGE] Analysing log files...');
    reportPhase('Analysing log files', 'Checking for bloated logs...');
    logAnalysis = analyseLogFiles(projectPath);
    if (logAnalysis.hasIssues) {
      reportPhase('Analysing log files', `Found ${logAnalysis.summary.totalLogFormatted} of logs`);
    }
    console.error('[STAGE] Log analysis complete');
  } else {
    console.error('[STAGE] Log analysis skipped (feature disabled)');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 13: Emissions Calculation
  // ═══════════════════════════════════════════════════════════════════════════

  // Calculate sizes (always needed for summary)
  const totalSize = getTotalSize(files);
  const codeSize = getTotalSize(categorised.javascript) + getTotalSize(categorised.css);
  const assetSize = getTotalSize(categorised.assets);
  const codeAndAssetSize = codeSize + assetSize;

  const deadCodeSize = calculateDeadCodeSize(deadCode, jsAnalysis);
  const duplicateSize = calculateDuplicateSize(duplicates, jsAnalysis);
  const unusedDepSize = unusedDeps.reduce((sum, d) => sum + (d.sizeBytes || 0), 0);
  const unusedAssetSize = unusedAssets.reduce((sum, a) => sum + a.sizeBytes, 0);

  const actualWasteSize = deadCodeSize + duplicateSize + unusedAssetSize;
  const optimisationOpportunities = assetOptimisation.potentialSavings;
  const sourceWasteSize = actualWasteSize;
  const totalPotentialSavings = sourceWasteSize + optimisationOpportunities + unusedDepSize;

  const wasteBaseSize = codeAndAssetSize > 0 ? codeAndAssetSize : totalSize;
  const cappedSourceWaste = Math.min(sourceWasteSize, wasteBaseSize);

  let emissions = { co2: 0, trees: 0, buildInfo: {} };

  if (features.emissions !== false) {
    console.error('[STAGE] Calculating emissions...');
    reportPhase(SCAN_PHASES.EMISSIONS.name, 'Calculating carbon footprint...');

    const buildOutputSize = bundles.totalSize > 0 ? bundles.totalSize : null;
    const emissionsBuildSize = buildOutputSize || Math.min(codeAndAssetSize > 0 ? codeAndAssetSize : totalSize, 50 * 1024 * 1024);
    const emissionsWasteRatio = wasteBaseSize > 0 ? cappedSourceWaste / wasteBaseSize : 0;
    const emissionsWasteSize = emissionsBuildSize * emissionsWasteRatio;

    emissions = calculateEmissions({
      buildSizeBytes: emissionsBuildSize,
      wasteBytes: emissionsWasteSize,
      ...config.emissions
    });

    emissions.buildInfo = {
      hasBuildFolder: bundles.totalSize > 0,
      buildOutputSize,
      sourceSize: totalSize,
      usedForCalculation: emissionsBuildSize
    };
  } else {
    console.error('[STAGE] Emissions calculation skipped (feature disabled)');
  }
  advancePhase('EMISSIONS');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 14: Finalize Results
  // ═══════════════════════════════════════════════════════════════════════════
  reportPhase(SCAN_PHASES.FINALIZING.name, 'Generating report...');

  const findings = applyRules({
    jsAnalysis,
    cssAnalysis,
    assetAnalysis,
    dependencies,
    deadCode,
    duplicates,
    unusedDeps,
    heavyDeps,
    bundles,
    assetOptimisation,
    unusedAssets,
    codePatterns
  }, config.rules);

  // Add log file findings
  if (logAnalysis.findings && logAnalysis.findings.length > 0) {
    findings.push(...logAnalysis.findings);
  }

  // Waste percentage based on code+assets, not total (which may include huge logs)
  const wastePercent = wasteBaseSize > 0 ? (cappedSourceWaste / wasteBaseSize) * 100 : 0;

  // Cost calculation with full details for per-finding breakdown
  const costs = calculateCosts({
    summary: { totalSizeBytes: totalSize, wasteSizeBytes: cappedSourceWaste, wastePercent },
    details: {
      deadCode,
      unusedDeps,
      unusedAssets,
      assetOptimisation
    }
  }, config);

  const healthScore = calculateHealthScore({
    summary: { wastePercent },
    security,
    licenses,
    outdated,
    emissions,
    codePatterns
  });

  const duration = Date.now() - startTime;
  advancePhase('FINALIZING');

  // Final progress report
  console.error(`[STAGE] Scan complete - ${files.length} files in ${(duration / 1000).toFixed(1)}s`);
  reportPhase('Scan complete', `Analysed ${files.length} files in ${(duration / 1000).toFixed(1)}s`);
  onProgress({ phase: 'Complete', percent: 100, detail: `${files.length} files scanned` });

  return {
    id: randomUUID(),
    projectPath,
    scannedAt: new Date().toISOString(),
    duration,

    summary: {
      fileCount: files.length,
      jsFileCount: categorised.javascript.length,
      cssFileCount: categorised.css.length,
      assetFileCount: categorised.assets.length,
      totalSizeBytes: totalSize,
      codeSizeBytes: codeAndAssetSize,  // Code + assets (excludes logs, data files)
      wasteSizeBytes: cappedSourceWaste,
      wastePercent,  // Based on code+asset size, not total
      deadCodeBytes: deadCodeSize,
      duplicateBytes: duplicateSize,
      unusedAssetBytes: unusedAssetSize,
      depWasteBytes: unusedDepSize,
      optimisationBytes: optimisationOpportunities,
      totalPotentialSavingsBytes: totalPotentialSavings,
      dependencyCount: dependencies.length,
      unusedDependencyCount: unusedDeps.length,
      deadCodeFiles: (deadCode.fullyDeadFiles?.length || 0) + (deadCode.partiallyDeadFiles?.length || 0),
      deadCodeExports: deadCode.summary?.totalDeadExports || 0,
      duplicateBlocks: duplicates.similarBlocks.length + duplicates.duplicateFunctions.length
    },

    findings: {
      critical: findings.filter(f => f.severity === 'critical'),
      warning: findings.filter(f => f.severity === 'warning'),
      info: findings.filter(f => f.severity === 'info')
    },

    emissions,
    security,
    codePatterns,
    licenses,
    outdated,
    costs,
    healthScore,

    details: {
      jsAnalysis,
      cssAnalysis,
      assetAnalysis,
      dependencies,
      deadCode,
      duplicates,
      unusedDeps,
      heavyDeps,
      bundles,
      assetOptimisation,
      unusedAssets,
      assets: assetsFullDepth,
      logAnalysis,
      importGraph: {
        usedPackages: Array.from(importGraph.usedPackages)
      }
    }
  };
}

/**
 * Run a quick scan (skip expensive analysis)
 */
export async function quickScan(projectPath, config = {}) {
  const startTime = Date.now();
  const onProgress = config.onProgress || defaultProgressReporter;

  onProgress({ phase: 'Quick scan', percent: 0, detail: 'Starting...' });

  const files = await discoverFiles(projectPath, {
    include: config.include,
    exclude: config.exclude
  });

  onProgress({ phase: 'Quick scan', percent: 30, detail: `Found ${files.length} files` });

  const categorised = categoriseFiles(files);
  const totalSize = getTotalSize(files);

  onProgress({ phase: 'Quick scan', percent: 60, detail: 'Analysing dependencies...' });

  const dependencies = await analyseDependencies(projectPath);
  const heavyDeps = checkHeavyDependencies(dependencies);

  const duration = Date.now() - startTime;

  onProgress({ phase: 'Complete', percent: 100, detail: `Scanned in ${(duration / 1000).toFixed(1)}s` });

  return {
    id: randomUUID(),
    projectPath,
    scannedAt: new Date().toISOString(),
    duration,
    quick: true,

    summary: {
      fileCount: files.length,
      jsFileCount: categorised.javascript.length,
      cssFileCount: categorised.css.length,
      assetFileCount: categorised.assets.length,
      totalSizeBytes: totalSize,
      dependencyCount: dependencies.length
    },

    heavyDependencies: heavyDeps,
    dependencies
  };
}

export default scanProject;
