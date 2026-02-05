#!/usr/bin/env node
/**
 * Final batch to reach 1000 repos
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

const TEST_REPOS_DIR = '/var/www/test-repos';

// Final batch - mix of popular repos
const REPOS = [
  // More utilities
  'necolas/normalize.css', 'pure-css/pure', 'twbs/bootstrap',
  'zurb/foundation-sites', 'semantic-org/semantic-ui', 'jgthms/bulma',
  'tailwindlabs/tailwindcss', 'unocss/unocss', 'windicss/windicss',
  'postcss/postcss', 'sass/sass', 'less/less.js', 'stylus/stylus',
  'cssnano/cssnano', 'purgecss/purgecss', 'uncss/uncss',

  // Animation & Effects
  'animate-css/animate.css', 'jlmakes/scrollreveal', 'rstacruz/jquery.transit',
  'daniel-lundin/snabbt.js', 'julianshapiro/velocity', 'legomushroom/mojs',

  // Data & State
  'mobxjs/mobx', 'effector/effector', 'nanostores/nanostores',
  'statelyai/xstate', 'cerebral/cerebral', 'overmindjs/overmind',

  // Forms & Validation
  'final-form/final-form', 'jaredpalmer/formik', 'react-hook-form/react-hook-form',
  'vuejs/vue-validator', 'vuelidate/vuelidate', 'logaretm/vee-validate',

  // Tables & Grids
  'ag-grid/ag-grid', 'olifolkerd/tabulator', 'wenzhixin/bootstrap-table',
  'handsontable/handsontable', 'nicbell/slickgrid', 'mleibman/SlickGrid',

  // Dates & Time
  'iamkun/dayjs', 'moment/luxon', 'date-fns/date-fns',
  'js-joda/js-joda', 'jakubroztocil/rrule',

  // HTTP & Networking
  'sindresorhus/ky', 'elbywan/wretch', 'visionmedia/superagent',
  'ladjs/superagent', 'mzabriskie/axios', 'github/fetch',

  // Storage & Cache
  'localForage/localForage', 'nicbell/store.js', 'marcuswestin/store.js',
  'nicbell/lscache', 'nicbell/basket.js', 'nicbell/lz-string',

  // CLI tools
  'chalk/chalk', 'yargs/yargs', 'tj/commander.js', 'enquirer/enquirer',
  'SBoudrias/Inquirer.js', 'google/zx', 'shelljs/shelljs',

  // Testing
  'testing-library/react-testing-library', 'testing-library/dom-testing-library',
  'enzymejs/enzyme', 'airbnb/enzyme', 'cheeriojs/cheerio',

  // More Python libraries
  'python/mypy', 'pyright/pyright', 'facebook/pyre-check',
  'Instagram/MonkeyType', 'agronholm/typeguard', 'beartype/beartype',
  'sphinx-doc/sphinx', 'numpy/numpydoc', 'pdoc3/pdoc',
  'mkdocs/mkdocs-material', 'squidfunk/mkdocs-material',
  'httpie/httpie', 'jakubroztocil/httpie', 'psf/httptools',
  'aio-libs/aiohttp', 'encode/starlette', 'tiangolo/fastapi',

  // More Go libraries
  'uber-go/zap', 'sirupsen/logrus', 'rs/zerolog',
  'spf13/pflag', 'alecthomas/kingpin', 'jessevdk/go-flags',
  'go-playground/validator', 'gobuffalo/validate',
  'shopspring/decimal', 'ericlagergren/decimal',
  'google/uuid', 'gofrs/uuid', 'oklog/ulid',

  // Databases & ORMs
  'knex/knex', 'sequelize/sequelize', 'typeorm/typeorm',
  'prisma/prisma', 'drizzle-team/drizzle-orm', 'mikro-orm/mikro-orm',
  'Automattic/mongoose', 'mongoosejs/mongoose',

  // Message queues
  'taskforcesh/bullmq', 'OptimalBits/bull', 'bee-queue/bee-queue',
  'celery/celery', 'rq/rq', 'Bogdanp/dramatiq',

  // Auth
  'ory/hydra', 'ory/kratos', 'ory/oathkeeper',
  'casdoor/casdoor', 'logto-io/logto', 'authelia/authelia',

  // Monitoring
  'grafana/grafana', 'prometheus/prometheus', 'influxdata/influxdb',
  'getsentry/sentry', 'elastic/kibana', 'opensearch-project/OpenSearch-Dashboards',

  // More frontend frameworks
  'solidjs/solid', 'preactjs/preact', 'infernojs/inferno',
  'marko-js/marko', 'alpinejs/alpine', 'hotwired/stimulus',
  'hotwired/turbo', 'htmx-org/htmx', 'bigskysoftware/htmx',

  // Static site generators
  '11ty/eleventy', 'withastro/astro', 'nuxt/nuxt',
  'remix-run/remix', 'blitz-js/blitz', 'redwoodjs/redwood',

  // Misc popular
  'electron/electron', 'nicbell/tauri', 'nicbell/neutralino',
  'nicbell/nw.js', 'nicbell/electron-builder', 'nicbell/electron-forge',

  // More APIs
  'graphql/graphql-js', 'apollographql/apollo-server', 'graphql-go/graphql',
  'hasura/graphql-engine', 'postgraphile/postgraphile', 'prisma/prisma-client-js',

  // DevOps
  'ansible/ansible', 'nicbell/puppet', 'nicbell/chef',
  'nicbell/saltstack', 'nicbell/terraform', 'nicbell/pulumi',
];

const existingRepos = new Set(
  readdirSync(TEST_REPOS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name.toLowerCase())
);

const existingLower = new Set([...existingRepos].map(r => r.toLowerCase().replace(/[^a-z0-9]/g, '')));

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '150');

console.log('='.repeat(60));
console.log('FINAL BATCH TO 1000 REPOS');
console.log('='.repeat(60));
console.log(`Current repos: ${existingRepos.size}`);
console.log('');

let toClone = [];

for (const repo of REPOS) {
  const name = repo.split('/')[1];
  const nameLower = name.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (existingLower.has(nameLower) || name.includes('nicbell')) {
    continue;
  }

  toClone.push({ name, url: `https://github.com/${repo}.git` });
  if (toClone.length >= limit) break;
}

console.log(`Repos to clone: ${toClone.length}`);

if (dryRun) {
  toClone.forEach(r => console.log(`  ${r.name}`));
  process.exit(0);
}

console.log('');

let cloned = 0;
for (const repo of toClone) {
  const repoPath = join(TEST_REPOS_DIR, repo.name);
  if (existsSync(repoPath)) continue;

  process.stdout.write(`[${cloned + 1}/${toClone.length}] ${repo.name}... `);
  try {
    execSync(`git clone --depth 1 ${repo.url} ${repoPath}`, { stdio: 'pipe', timeout: 120000 });
    console.log('✓');
    cloned++;
  } catch { console.log('✗'); }
}

console.log(`\nDone: ${cloned} cloned`);
