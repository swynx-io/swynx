#!/usr/bin/env node
/**
 * Expand training data to 1000 repos
 * Focus on smaller repos (< 10k files) to avoid slowdowns
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

const TEST_REPOS_DIR = '/var/www/test-repos';

// Popular repos across languages - smaller/medium sized
const REPOS = [
  // JavaScript/TypeScript - utilities & libraries
  'lodash/lodash', 'axios/axios', 'expressjs/express', 'koajs/koa',
  'fastify/fastify', 'hapijs/hapi', 'moleculerjs/moleculer', 'feathersjs/feathers',
  'date-fns/date-fns', 'moment/moment', 'dayjs/dayjs', 'luxon/luxon',
  'chalk/chalk', 'SBoudrias/Inquirer.js', 'sindresorhus/ora', 'sindresorhus/execa',
  'validatorjs/validator.js', 'jquense/yup', 'colinhacks/zod', 'hapijs/joi',
  'facebook/jest', 'mochajs/mocha', 'avajs/ava', 'jasmine/jasmine',
  'puppeteer/puppeteer', 'microsoft/playwright', 'cypress-io/cypress',
  'webpack/webpack-cli', 'vitejs/vite-plugin-react', 'evanw/esbuild',
  'remarkjs/remark', 'mdx-js/mdx', 'unified/unified',
  'pmndrs/zustand', 'pmndrs/jotai', 'pmndrs/valtio',
  'TanStack/query', 'TanStack/table', 'TanStack/router',
  'reduxjs/redux', 'reduxjs/reselect', 'immerjs/immer',
  'floating-ui/floating-ui', 'radix-ui/primitives', 'shadcn-ui/ui',
  'tailwindlabs/headlessui', 'mantinedev/mantine',
  'formium/formik', 'react-hook-form/react-hook-form',
  'nock/nock', 'node-fetch/node-fetch', 'sindresorhus/got',
  'sindresorhus/p-limit', 'sindresorhus/globby', 'mrmlnc/fast-glob',
  'isaacs/node-glob', 'micromatch/micromatch',
  'terser/terser', 'swc-project/swc', 'babel/babel',
  'prettier/prettier', 'eslint/eslint', 'stylelint/stylelint',
  'husky-js/husky', 'lint-staged/lint-staged', 'commitizen/cz-cli',
  'conventional-changelog/conventional-changelog',
  'lerna/lerna', 'changesets/changesets', 'rushjs/rush',
  'unjs/nitro', 'unjs/h3', 'unjs/ofetch', 'unjs/consola',
  'nuxt/nuxt', 'nuxt/content', 'nuxt/image',

  // React ecosystem
  'facebook/react', 'vercel/swr', 'pmndrs/react-spring',
  'framer/motion', 'react-icons/react-icons',
  'react-dnd/react-dnd', 'clauderic/dnd-kit',
  'bvaughn/react-virtualized', 'TanStack/virtual',
  'recharts/recharts', 'airbnb/visx', 'plouc/nivo',

  // Vue ecosystem
  'vuejs/vue', 'vuejs/pinia', 'vuejs/router',
  'vueuse/vueuse', 'element-plus/element-plus',

  // Node.js tools
  'tj/commander.js', 'yargs/yargs', 'cacjs/cac',
  'paulmillr/chokidar', 'nodemon/nodemon',
  'remy/nodemon', 'foreversd/forever',
  'pm2/pm2', 'Unitech/pm2',

  // Python - web & utilities
  'pallets/flask', 'pallets/click', 'pallets/jinja',
  'psf/requests', 'aio-libs/aiohttp', 'encode/httpx',
  'pytest-dev/pytest', 'tox-dev/tox',
  'pypa/pip', 'pypa/setuptools', 'pypa/pipenv',
  'python-poetry/poetry', 'pdm-project/pdm',
  'psf/black', 'PyCQA/flake8', 'PyCQA/pylint', 'astral-sh/ruff',
  'pydantic/pydantic', 'samuelcolvin/pydantic-settings',
  'tiangolo/typer', 'Textualize/rich', 'Textualize/textual',
  'PyGithub/PyGithub', 'gitpython-developers/GitPython',
  'boto/boto3', 'aws/aws-cli',
  'celery/celery', 'rq/rq', 'Bogdanp/dramatiq',
  'sqlalchemy/sqlalchemy', 'tortoise/tortoise-orm',
  'encode/databases', 'piccolo-orm/piccolo',
  'marshmallow-code/marshmallow', 'lidatong/dataclasses-json',

  // Go - tools & libraries
  'spf13/cobra', 'spf13/viper', 'urfave/cli',
  'sirupsen/logrus', 'uber-go/zap', 'rs/zerolog',
  'stretchr/testify', 'onsi/ginkgo', 'onsi/gomega',
  'go-chi/chi', 'labstack/echo', 'gofiber/fiber',
  'gin-gonic/gin', 'gorilla/mux', 'julienschmidt/httprouter',
  'go-redis/redis', 'go-gorm/gorm', 'jmoiron/sqlx',
  'golang-migrate/migrate', 'pressly/goose',
  'hashicorp/go-plugin', 'hashicorp/go-multierror',
  'pkg/errors', 'cockroachdb/errors',
  'grpc/grpc-go', 'twitchtv/twirp',
  'nats-io/nats.go', 'segmentio/kafka-go',
  'prometheus/client_golang', 'opentracing/opentracing-go',

  // Java - utilities
  'google/guava', 'apache/commons-lang',
  'apache/commons-io', 'apache/commons-collections',
  'projectlombok/lombok', 'mapstruct/mapstruct',
  'google/gson', 'FasterXML/jackson-core',
  'square/okhttp', 'square/retrofit',
  'mockito/mockito', 'assertj/assertj',
  'junit-team/junit5', 'junit-team/junit4',
  'checkstyle/checkstyle', 'spotbugs/spotbugs',
  'resilience4j/resilience4j', 'Netflix/Hystrix',
  'google/dagger', 'google/guice',
  'micrometer-metrics/micrometer',

  // Rust - popular crates
  'serde-rs/serde', 'serde-rs/json',
  'tokio-rs/tokio', 'tokio-rs/axum', 'tokio-rs/tracing',
  'hyperium/hyper', 'hyperium/tonic',
  'clap-rs/clap', 'BurntSushi/ripgrep',
  'sharkdp/bat', 'sharkdp/fd', 'sharkdp/hyperfine',
  'ogham/exa', 'Peltoche/lsd',
  'starship/starship', 'ajeetdsouza/zoxide',
  'rust-lang/rustfmt', 'rust-lang/rust-clippy',
  'launchbadge/sqlx', 'diesel-rs/diesel',

  // DevOps & Infrastructure
  'docker/compose', 'docker/cli',
  'kubernetes/kubectl', 'kubernetes/kops',
  'helm/helm', 'helmfile/helmfile',
  'argoproj/argo-cd', 'argoproj/argo-workflows',
  'fluxcd/flux2', 'fluxcd/flagger',
  'crossplane/crossplane', 'pulumi/examples',
  'gruntwork-io/terragrunt', 'terraform-linters/tflint',
  'aquasecurity/trivy', 'anchore/grype',

  // More JS utilities
  'lodash/lodash', 'ramda/ramda', 'immutable-js/immutable-js',
  'Reactive-Extensions/RxJS', 'baconjs/bacon.js',
  'kriskowal/q', 'petkaantonov/bluebird',
  'caolan/async', 'sindresorhus/pify',
  'browserify/browserify', 'requirejs/requirejs',
  'amdjs/amdjs-api', 'systemjs/systemjs',
  'substack/node-browserify', 'defunctzombie/node-process',

  // Testing & Mocking
  'sinonjs/sinon', 'jhnns/rewire', 'thlorenz/proxyquire',
  'visionmedia/supertest', 'ladjs/superagent',
  'chimurai/http-proxy-middleware',

  // Build tools
  'gulpjs/gulp', 'gruntjs/grunt',
  'brunch/brunch', 'broccolijs/broccoli',

  // More Python
  'pallets/werkzeug', 'mitsuhiko/click',
  'davidhalter/jedi', 'python-lsp/python-lsp-server',
  'ipython/ipython', 'jupyter/notebook',
  'matplotlib/matplotlib', 'numpy/numpy',
  'pandas-dev/pandas', 'scikit-learn/scikit-learn',

  // More Go
  'containerd/containerd', 'moby/moby',
  'kubernetes/client-go', 'kubernetes/api',
  'etcd-io/etcd', 'etcd-io/bbolt',
  'coreos/go-systemd', 'coreos/go-semver',

  // Documentation & Static Sites
  'mkdocs/mkdocs', 'squidfunk/mkdocs-material',
  'sphinx-doc/sphinx', 'readthedocs/readthedocs.org',
  '11ty/eleventy', 'withastro/astro',
  'gohugoio/hugo', 'jekyll/jekyll',
  'hexojs/hexo', 'vuejs/vuepress',

  // APIs & GraphQL
  'graphql/graphql-js', 'graphql/graphql-spec',
  'apollographql/apollo-client', 'urql-graphql/urql',
  'prisma/prisma-client-js', 'typeorm/typeorm',
  'sequelize/sequelize', 'knex/knex',

  // Auth & Security
  'jaredhanson/passport', 'panva/jose',
  'auth0/node-jsonwebtoken', 'kelektiv/node-uuid',
  'uuidjs/uuid', 'ai/nanoid',

  // Misc popular
  'socketio/socket.io', 'socketio/socket.io-client',
  'websockets/ws', 'faye/faye-websocket-node',
  'nodemailer/nodemailer', 'forwardemail/email-templates',
  'Automattic/mongoose', 'mongodb/node-mongodb-native',
  'redis/node-redis', 'luin/ioredis',
  'elastic/elasticsearch-js', 'algolia/algoliasearch-client-javascript',
  'aws/aws-sdk-js-v3', 'googleapis/google-api-nodejs-client',
  'stripe/stripe-node', 'braintree/braintree-node',
  'twilio/twilio-node', 'sendgrid/sendgrid-nodejs',
];

// Get existing repos
const existingRepos = new Set(
  readdirSync(TEST_REPOS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name.toLowerCase())
);

// Also check for repos with different naming
const existingLower = new Set([...existingRepos].map(r => r.toLowerCase().replace(/[^a-z0-9]/g, '')));

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '500');

console.log('='.repeat(60));
console.log('EXPAND TO 1000 REPOS');
console.log('='.repeat(60));
console.log(`Current repos: ${existingRepos.size}`);
console.log(`Target: 1000 repos`);
console.log(`Limit this run: ${limit}`);
console.log('');

let toClone = [];

for (const repo of REPOS) {
  const name = repo.split('/')[1];
  const nameLower = name.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (existingLower.has(nameLower)) {
    continue;
  }

  toClone.push({ name, url: `https://github.com/${repo}.git` });

  if (toClone.length >= limit) break;
}

console.log(`Repos to clone: ${toClone.length}`);
console.log('');

if (dryRun) {
  console.log('DRY RUN - repos that would be cloned:');
  toClone.slice(0, 30).forEach(r => console.log(`  ${r.name}`));
  if (toClone.length > 30) console.log(`  ... and ${toClone.length - 30} more`);
  process.exit(0);
}

let cloned = 0;
let failed = [];

for (const repo of toClone) {
  const repoPath = join(TEST_REPOS_DIR, repo.name);
  console.log(`[${cloned + 1}/${toClone.length}] Cloning ${repo.name}...`);

  try {
    execSync(`git clone --depth 1 ${repo.url} ${repoPath}`, {
      stdio: 'pipe',
      timeout: 120000 // 2 min timeout
    });
    cloned++;
  } catch (err) {
    console.log(`  ✗ Failed`);
    failed.push(repo.name);
  }
}

console.log('');
console.log('='.repeat(60));
console.log(`CLONE COMPLETE: ${cloned}/${toClone.length}`);
if (failed.length > 0) {
  console.log(`Failed (${failed.length}): ${failed.slice(0, 10).join(', ')}${failed.length > 10 ? '...' : ''}`);
}
console.log('');
console.log('Next: node scan-all-repos.mjs --scan-all-dirs --skip-existing');
console.log('='.repeat(60));
