#!/usr/bin/env node
/**
 * Swynx Stress Test — clone diverse repos and scan them all.
 * Targets enterprise patterns: Spring Boot, NestJS, Django, .NET, Go, Rust, monorepos.
 *
 * Usage:
 *   node scripts/stress-test.mjs                  # clone + scan all
 *   node scripts/stress-test.mjs --scan-only      # skip cloning, scan existing
 *   node scripts/stress-test.mjs --repo express   # scan one repo by name
 *   node scripts/stress-test.mjs --summary        # just print summary from last run
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const REPOS_DIR = '/var/www/stress-test-repos';
const RESULTS_DIR = join(REPOS_DIR, '_results');
const SWYNX_BIN = '/var/www/swynx/bin/swynx';

// Diverse repos covering frameworks a £6m enterprise / MOD partner might use
const REPOS = [
  // === Java / Spring Boot (MOD-likely) ===
  { url: 'https://github.com/spring-projects/spring-petclinic', tags: ['java', 'spring'] },
  { url: 'https://github.com/eugenp/tutorials', tags: ['java', 'spring', 'large'], shallow: true },
  { url: 'https://github.com/iluwatar/java-design-patterns', tags: ['java', 'patterns'] },
  { url: 'https://github.com/quarkusio/quarkus-quickstarts', tags: ['java', 'quarkus'] },
  { url: 'https://github.com/micronaut-projects/micronaut-core', tags: ['java', 'micronaut'] },

  // === .NET / C# (MOD-likely) ===
  { url: 'https://github.com/dotnet/eShop', tags: ['csharp', 'dotnet', 'microservices'] },
  { url: 'https://github.com/jasontaylordev/CleanArchitecture', tags: ['csharp', 'dotnet'] },
  { url: 'https://github.com/abpframework/abp', tags: ['csharp', 'dotnet', 'large'], shallow: true },

  // === Go (MOD/infra-likely) ===
  { url: 'https://github.com/kubernetes/kubectl', tags: ['go', 'k8s'] },
  { url: 'https://github.com/hashicorp/terraform-provider-aws', tags: ['go', 'terraform', 'large'], shallow: true },
  { url: 'https://github.com/grafana/loki', tags: ['go', 'observability'] },

  // === TypeScript / NestJS (enterprise Node) ===
  { url: 'https://github.com/nestjs/nest', tags: ['typescript', 'nestjs', 'di'] },
  { url: 'https://github.com/typeorm/typeorm', tags: ['typescript', 'orm'] },
  { url: 'https://github.com/strapi/strapi', tags: ['typescript', 'cms', 'large'] },
  { url: 'https://github.com/calcom/cal.com', tags: ['typescript', 'monorepo', 'nextjs'] },

  // === Python / Django (enterprise) ===
  { url: 'https://github.com/django/django', tags: ['python', 'django', 'large'] },
  { url: 'https://github.com/encode/django-rest-framework', tags: ['python', 'django', 'api'] },
  { url: 'https://github.com/tiangolo/fastapi', tags: ['python', 'fastapi'] },

  // === Rust (security-focused, MOD-relevant) ===
  { url: 'https://github.com/rustls/rustls', tags: ['rust', 'security'] },
  { url: 'https://github.com/tokio-rs/axum', tags: ['rust', 'web'] },

  // === Ruby / Rails ===
  { url: 'https://github.com/rails/rails', tags: ['ruby', 'rails', 'large'], shallow: true },
  { url: 'https://github.com/discourse/discourse', tags: ['ruby', 'rails', 'large'], shallow: true },

  // === PHP / Laravel ===
  { url: 'https://github.com/laravel/framework', tags: ['php', 'laravel'] },

  // === Monorepos / Multi-language ===
  { url: 'https://github.com/vercel/next.js', tags: ['typescript', 'monorepo', 'large'], shallow: true },
  { url: 'https://github.com/angular/angular', tags: ['typescript', 'angular', 'monorepo'], shallow: true },
];

// --- CLI parsing ---
const args = process.argv.slice(2);
const scanOnly = args.includes('--scan-only');
const summaryOnly = args.includes('--summary');
const singleRepo = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : null;

mkdirSync(RESULTS_DIR, { recursive: true });

// --- Clone ---
function cloneRepo(repo) {
  const name = basename(repo.url).replace(/\.git$/, '');
  const dest = join(REPOS_DIR, name);

  if (existsSync(dest)) {
    console.log(`  [skip] ${name} already exists`);
    return dest;
  }

  const depthFlag = repo.shallow !== false ? '--depth 1' : '';
  const cmd = `git clone ${depthFlag} ${repo.url} ${dest} 2>&1`;

  try {
    console.log(`  [clone] ${name}...`);
    execSync(cmd, { timeout: 120_000, stdio: 'pipe' });
    return dest;
  } catch (e) {
    console.log(`  [FAIL] ${name}: ${e.message?.slice(0, 100)}`);
    return null;
  }
}

// --- Scan ---
function scanRepo(repoPath) {
  const name = basename(repoPath);
  const resultFile = join(RESULTS_DIR, `${name}.json`);

  console.log(`  [scan] ${name}...`);

  try {
    const output = execSync(
      `node ${SWYNX_BIN} scan ${repoPath} --format json 2>/dev/null`,
      { timeout: 300_000, maxBuffer: 50 * 1024 * 1024 }
    ).toString();

    const data = JSON.parse(output);
    const result = {
      name,
      timestamp: new Date().toISOString(),
      summary: data.summary,
      unusedFiles: (data.unusedFiles || []).map(f => ({
        path: f.path,
        size: f.size,
        verdict: f.verdict,
        confidence: f.evidence?.confidence?.score,
      })),
      unusedFunctions: (data.unusedFunctions || []).map(f => ({
        name: f.name,
        file: f.file,
        line: f.line,
      })),
    };

    writeFileSync(resultFile, JSON.stringify(result, null, 2));

    const fileCount = result.unusedFiles.length;
    const fnCount = result.unusedFunctions.length;
    const total = data.summary?.totalFilesScanned || 0;
    const pct = total > 0 ? ((fileCount / total) * 100).toFixed(1) : '0';

    console.log(`         ${total} files scanned, ${fileCount} unused files, ${fnCount} unused functions (${pct}%)`);

    // Flag suspicious results
    if (fileCount > 0 && total > 0) {
      const rate = fileCount / total;
      if (rate > 0.15) {
        console.log(`  [WARN] ${name}: ${(rate * 100).toFixed(0)}% dead rate — may indicate FP class`);
      }
    }

    return result;
  } catch (e) {
    const errMsg = e.message?.slice(0, 200) || 'unknown error';
    console.log(`  [FAIL] ${name}: ${errMsg}`);
    writeFileSync(resultFile, JSON.stringify({ name, error: errMsg }, null, 2));
    return { name, error: errMsg };
  }
}

// --- Summary ---
function printSummary() {
  const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));

  let totalScanned = 0;
  let totalDead = 0;
  let totalFns = 0;
  const rows = [];
  const suspiciousFindings = [];

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(RESULTS_DIR, file), 'utf-8'));
      if (data.error) {
        rows.push({ name: data.name, scanned: '-', dead: '-', fns: '-', pct: 'ERR', note: data.error.slice(0, 50) });
        continue;
      }

      const scanned = data.summary?.totalFilesScanned || 0;
      const dead = data.unusedFiles?.length || 0;
      const fns = data.unusedFunctions?.length || 0;
      const pct = scanned > 0 ? ((dead / scanned) * 100).toFixed(1) : '0.0';

      totalScanned += scanned;
      totalDead += dead;
      totalFns += fns;

      let note = '';
      if (scanned > 0 && dead / scanned > 0.15) note = 'HIGH RATE';
      if (dead === 0 && scanned > 100) note = 'clean';

      rows.push({ name: data.name, scanned, dead, fns, pct: pct + '%', note });

      // Collect findings that look suspicious for manual review
      if (data.unusedFiles) {
        for (const f of data.unusedFiles) {
          // Flag anything that looks like it should be an entry point
          const suspicious =
            /\/(index|main|app|server|bootstrap)\.[a-z]+$/.test(f.path) ||
            /\/controllers?\//.test(f.path) ||
            /\/routes?\//.test(f.path) ||
            /\/middleware\//.test(f.path);

          if (suspicious) {
            suspiciousFindings.push({ repo: data.name, path: f.path, confidence: f.confidence });
          }
        }
      }
    } catch (e) {
      // skip
    }
  }

  // Print table
  console.log('\n' + '='.repeat(90));
  console.log('STRESS TEST SUMMARY');
  console.log('='.repeat(90));
  console.log('');
  console.log(`${'Repo'.padEnd(35)} ${'Scanned'.padStart(8)} ${'Dead'.padStart(6)} ${'Fns'.padStart(5)} ${'Rate'.padStart(7)}  Notes`);
  console.log('-'.repeat(90));

  rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  for (const r of rows) {
    console.log(
      `${(r.name || '').padEnd(35)} ${String(r.scanned).padStart(8)} ${String(r.dead).padStart(6)} ${String(r.fns).padStart(5)} ${String(r.pct).padStart(7)}  ${r.note || ''}`
    );
  }

  console.log('-'.repeat(90));
  const totalPct = totalScanned > 0 ? ((totalDead / totalScanned) * 100).toFixed(2) : '0.00';
  console.log(`${'TOTAL'.padEnd(35)} ${String(totalScanned).padStart(8)} ${String(totalDead).padStart(6)} ${String(totalFns).padStart(5)} ${(totalPct + '%').padStart(7)}`);
  console.log('');

  // Print suspicious findings for manual review
  if (suspiciousFindings.length > 0) {
    console.log('='.repeat(90));
    console.log('FINDINGS TO MANUALLY VERIFY (controllers, routes, middleware, index files)');
    console.log('='.repeat(90));
    for (const s of suspiciousFindings) {
      const conf = s.confidence != null ? ` (${Math.round(s.confidence * 100)}%)` : '';
      console.log(`  [${s.repo}] ${s.path}${conf}`);
    }
    console.log(`\n  ${suspiciousFindings.length} finding(s) worth double-checking`);
  } else {
    console.log('No suspicious findings detected (no controllers/routes/middleware/index files flagged)');
  }

  console.log('');
}

// --- Main ---
async function main() {
  if (summaryOnly) {
    printSummary();
    return;
  }

  mkdirSync(REPOS_DIR, { recursive: true });

  const reposToScan = [];

  if (singleRepo) {
    const match = REPOS.find(r => basename(r.url).replace(/\.git$/, '').toLowerCase().includes(singleRepo.toLowerCase()));
    if (match) {
      const dest = join(REPOS_DIR, basename(match.url).replace(/\.git$/, ''));
      if (!existsSync(dest)) cloneRepo(match);
      if (existsSync(dest)) reposToScan.push(dest);
    } else {
      // Try direct path
      const direct = join(REPOS_DIR, singleRepo);
      if (existsSync(direct)) reposToScan.push(direct);
      else { console.log(`Repo "${singleRepo}" not found`); return; }
    }
  } else {
    if (!scanOnly) {
      console.log(`\nCloning ${REPOS.length} repos into ${REPOS_DIR}...\n`);
      for (const repo of REPOS) {
        const dest = cloneRepo(repo);
        if (dest) reposToScan.push(dest);
      }
    } else {
      const entries = readdirSync(REPOS_DIR, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && e.name !== '_results') {
          reposToScan.push(join(REPOS_DIR, e.name));
        }
      }
    }
  }

  console.log(`\nScanning ${reposToScan.length} repos...\n`);

  for (const repoPath of reposToScan) {
    scanRepo(repoPath);
  }

  printSummary();
}

main().catch(e => { console.error(e); process.exit(1); });
