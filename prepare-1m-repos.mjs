#!/usr/bin/env node
/**
 * Prepare repos for 1M file milestone
 * Clones popular repos we're missing that will add ~166k files
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const TEST_REPOS_DIR = '/var/www/test-repos';

// Repos to add with estimated file counts
// Targeting ~200k files to have buffer over 166k needed
const REPOS_TO_ADD = [
  // Large TypeScript/JavaScript
  { name: 'angular', url: 'https://github.com/angular/angular.git', est: 15000 },
  { name: 'kibana', url: 'https://github.com/elastic/kibana.git', est: 40000 },
  { name: 'grafana', url: 'https://github.com/grafana/grafana.git', est: 25000 },
  { name: 'gatsby', url: 'https://github.com/gatsbyjs/gatsby.git', est: 8000 },
  { name: 'sveltekit', url: 'https://github.com/sveltejs/kit.git', est: 2000 },
  { name: 'ember.js', url: 'https://github.com/emberjs/ember.js.git', est: 3000 },

  // Large Python
  { name: 'ansible', url: 'https://github.com/ansible/ansible.git', est: 15000 },
  { name: 'sentry', url: 'https://github.com/getsentry/sentry.git', est: 12000 },
  { name: 'posthog', url: 'https://github.com/PostHog/posthog.git', est: 8000 },

  // Large Go
  { name: 'istio', url: 'https://github.com/istio/istio.git', est: 10000 },
  { name: 'traefik', url: 'https://github.com/traefik/traefik.git', est: 3000 },
  { name: 'minio', url: 'https://github.com/minio/minio.git', est: 4000 },
  { name: 'jaeger', url: 'https://github.com/jaegertracing/jaeger.git', est: 2000 },
  { name: 'tempo', url: 'https://github.com/grafana/tempo.git', est: 2000 },
  { name: 'loki', url: 'https://github.com/grafana/loki.git', est: 4000 },

  // Large Java
  { name: 'opensearch', url: 'https://github.com/opensearch-project/OpenSearch.git', est: 25000 },

  // Additional JS/TS
  { name: 'directus', url: 'https://github.com/directus/directus.git', est: 4000 },
  { name: 'payload', url: 'https://github.com/payloadcms/payload.git', est: 5000 },
  { name: 'nocodb', url: 'https://github.com/nocodb/nocodb.git', est: 4000 },
  { name: 'appsmith', url: 'https://github.com/appsmithorg/appsmith.git', est: 8000 },
  { name: 'tooljet', url: 'https://github.com/ToolJet/ToolJet.git', est: 4000 },
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyMissing = args.includes('--only-missing');

console.log('='.repeat(60));
console.log('PREPARE REPOS FOR 1M FILE MILESTONE');
console.log('='.repeat(60));
console.log('');

let totalEst = 0;
let toClone = [];

for (const repo of REPOS_TO_ADD) {
  const repoPath = join(TEST_REPOS_DIR, repo.name);
  const exists = existsSync(repoPath);

  if (exists && onlyMissing) {
    console.log(`  ✓ ${repo.name} (exists)`);
    continue;
  }

  if (!exists) {
    toClone.push(repo);
    totalEst += repo.est;
    console.log(`  ○ ${repo.name} (~${repo.est.toLocaleString()} files)`);
  } else {
    console.log(`  ✓ ${repo.name} (exists)`);
  }
}

console.log('');
console.log(`Repos to clone: ${toClone.length}`);
console.log(`Estimated new files: ~${totalEst.toLocaleString()}`);
console.log(`Current files: 833,995`);
console.log(`Projected total: ~${(833995 + totalEst).toLocaleString()}`);
console.log('');

if (dryRun) {
  console.log('DRY RUN - no repos cloned');
  process.exit(0);
}

if (toClone.length === 0) {
  console.log('All repos already exist!');
  process.exit(0);
}

console.log('Cloning repos (shallow clone for speed)...');
console.log('');

let cloned = 0;
let failed = [];

for (const repo of toClone) {
  const repoPath = join(TEST_REPOS_DIR, repo.name);
  console.log(`[${cloned + 1}/${toClone.length}] Cloning ${repo.name}...`);

  try {
    execSync(`git clone --depth 1 ${repo.url} ${repoPath}`, {
      stdio: 'inherit',
      timeout: 300000 // 5 min timeout
    });
    cloned++;
    console.log(`  ✓ Done\n`);
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message}\n`);
    failed.push(repo.name);
  }
}

console.log('='.repeat(60));
console.log(`CLONE COMPLETE: ${cloned}/${toClone.length} repos`);
if (failed.length > 0) {
  console.log(`Failed: ${failed.join(', ')}`);
}
console.log('');
console.log('Next: Run scan with:');
console.log('  node scan-all-repos.mjs --skip-existing');
console.log('='.repeat(60));
