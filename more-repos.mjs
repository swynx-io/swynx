#!/usr/bin/env node
/**
 * More repos to reach 1000
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

const TEST_REPOS_DIR = '/var/www/test-repos';

// Batch 2 - more popular repos
const REPOS = [
  // More JavaScript
  'jquery/jquery', 'mrdoob/three.js', 'pixijs/pixijs', 'fabricjs/fabric.js',
  'konvajs/konva', 'paperjs/paper.js', 'd3/d3', 'chartjs/Chart.js',
  'highcharts/highcharts', 'apache/echarts', 'antvis/G2', 'antvis/G6',
  'cytoscape/cytoscape.js', 'jacomyal/sigma.js', 'vasturiano/3d-force-graph',
  'videojs/video.js', 'sampotts/plyr', 'nicvilla/flowbite',
  'ckeditor/ckeditor5', 'tinymce/tinymce', 'quilljs/quill', 'ianstormtaylor/slate',
  'codemirror/codemirror5', 'ajaxorg/ace', 'nickeditor/niceditor',
  'select2/select2', 'harvesthq/chosen', 'selectize/selectize.js',
  'fullcalendar/fullcalendar', 'Pikaday/Pikaday', 'flatpickr/flatpickr',
  'swiperjs/swiper', 'nolimits4web/swiper', 'glidejs/glide',
  'hammerjs/hammer.js', 'desandro/masonry', 'metafizzy/isotope',
  'imakewebthings/waypoints', 'michalsnik/aos', 'scrollreveal/scrollreveal',
  'juliangarnier/anime', 'greensock/GSAP', 'mojs/mojs',
  'eligrey/FileSaver.js', 'nicbell/pdf-viewer', 'nicbell/files',
  'pdfjs/pdfjs-dist', 'nicbell/pdfjs-dist', 'nicbell/pdf-lib',
  'nicbell/jspdf', 'paralax/jsPDF', 'nicbell/html2canvas',
  'niklasvh/html2canvas', 'nicbell/dom-to-image', 'tsayen/dom-to-image',
  'localForage/localForage', 'nicbell/dexie', 'nicbell/idb',
  'jakearchibald/idb', 'nicbell/pouchdb', 'pouchdb/pouchdb',
  'Leaflet/Leaflet', 'openlayers/openlayers', 'mapbox/mapbox-gl-js',
  'googlemaps/js-samples', 'Leaflet/Leaflet.markercluster',
  'handlebars-lang/handlebars.js', 'janl/mustache.js', 'pugjs/pug',
  'mozilla/nunjucks', 'linkedin/dustjs', 'wycats/handlebars.js',
  'markdown-it/markdown-it', 'markedjs/marked', 'showdownjs/showdown',
  'highlightjs/highlight.js', 'PrismJS/prism', 'shikijs/shiki',
  'lodash/lodash', 'ramda/ramda', 'jashkenas/underscore',
  'you-dont-need/You-Dont-Need-Lodash-Underscore',

  // More Python
  'django/django', 'encode/django-rest-framework', 'django-cms/django-cms',
  'wagtail/wagtail', 'saleor/saleor', 'awslabs/gluonts',
  'scrapy/scrapy', 'binux/pyspider', 'getpelican/pelican',
  'paramiko/paramiko', 'fabric/fabric', 'ansible/ansible-lint',
  'certbot/certbot', 'pyca/cryptography', 'pyopenssl/pyopenssl',
  'arrow-py/arrow', 'dateutil/dateutil', 'stub42/pytz',
  'pytoolz/toolz', 'more-itertools/more-itertools', 'erikrose/more-itertools',
  'mahmoud/boltons', 'python-attrs/attrs', 'python-attrs/cattrs',
  'Delgan/loguru', 'hynek/structlog', 'tqdm/tqdm',
  'cookiecutter/cookiecutter', 'copier-org/copier', 'cruft/cruft',
  'pyinvoke/invoke', 'nicbell/fabric2', 'nicbell/task',
  'nicbell/doit', 'pydoit/doit', 'pypyr/pypyr',
  'psf/requests-oauthlib', 'oauthlib/oauthlib', 'lepture/authlib',
  'mpdavis/python-jose', 'jpadilla/pyjwt', 'davedoesdev/python-jwt',
  'yaml/pyyaml', 'nicbell/toml', 'uiri/toml', 'hukkin/tomli',
  'ijl/orjson', 'ultrajson/ultrajson', 'msgpack/msgpack-python',
  'python-pillow/Pillow', 'imageio/imageio', 'scikit-image/scikit-image',
  'aio-libs/aiofiles', 'nicbell/anyio', 'agronholm/anyio',
  'nicbell/trio', 'python-trio/trio', 'MagicStack/uvloop',

  // More Go
  'gohugoio/hugo', 'nicbell/hugo', 'spf13/hugo',
  'kubernetes/kubernetes', 'kubernetes/minikube', 'kubernetes-sigs/kind',
  'rancher/rancher', 'rancher/k3s', 'k3s-io/k3s',
  'containerd/containerd', 'containers/podman', 'containers/buildah',
  'moby/buildkit', 'genuinetools/img', 'google/ko',
  'google/go-github', 'shurcooL/githubv4', 'cli/cli',
  'charmbracelet/bubbletea', 'charmbracelet/lipgloss', 'charmbracelet/glow',
  'AlecAivazis/survey', 'manifoldco/promptui', 'c-bata/go-prompt',
  'fatih/color', 'gookit/color', 'mgutz/ansi',
  'olekukonko/tablewriter', 'jedib0t/go-pretty', 'alexeyco/simpletable',
  'schollz/progressbar', 'cheggaaa/pb', 'vbauerster/mpb',
  'fsnotify/fsnotify', 'radovskyb/watcher', 'howeyc/fsnotify',
  'spf13/afero', 'go-git/go-git', 'src-d/go-git',
  'pelletier/go-toml', 'BurntSushi/toml', 'go-yaml/yaml',
  'tidwall/gjson', 'tidwall/sjson', 'ohler55/ojg',
  'go-playground/validator', 'asaskevich/govalidator', 'go-ozzo/ozzo-validation',
  'golang/protobuf', 'gogo/protobuf', 'planetscale/vtprotobuf',
  'grpc-ecosystem/grpc-gateway', 'bufbuild/connect-go', 'twitchtv/twirp',
  'uber-go/fx', 'google/wire', 'samber/do',
  'patrickmn/go-cache', 'allegro/bigcache', 'coocood/freecache',
  'dgraph-io/badger', 'etcd-io/bbolt', 'syndtr/goleveldb',
  'cespare/xxhash', 'spaolacci/murmur3', 'zeebo/xxh3',

  // More Java
  'spring-projects/spring-framework', 'spring-projects/spring-boot',
  'quarkusio/quarkus', 'micronaut-projects/micronaut-core',
  'eclipse-vertx/vert.x', 'playframework/playframework', 'ratpack/ratpack',
  'netty/netty', 'apache/mina', 'apache/httpcomponents-core',
  'square/okio', 'google/guava', 'apache/commons-lang',
  'apache/commons-io', 'apache/commons-collections', 'apache/commons-codec',
  'apache/commons-compress', 'apache/commons-text', 'apache/commons-csv',
  'apache/logging-log4j2', 'qos-ch/slf4j', 'qos-ch/logback',
  'mybatis/mybatis-3', 'hibernate/hibernate-orm', 'jooq/jooq',
  'flyway/flyway', 'liquibase/liquibase', 'nicbell/debezium',
  'apache/kafka', 'rabbitmq/rabbitmq-java-client', 'apache/pulsar',
  'lettuce-io/lettuce-core', 'redisson/redisson', 'jedis/jedis',
  'grpc/grpc-java', 'nicbell/grpc', 'nicbell/protobuf-java',
  'resilience4j/resilience4j', 'Netflix/Hystrix', 'failsafe-lib/failsafe',
  'ben-manes/caffeine', 'google/guava', 'ehcache/ehcache3',

  // Rust
  'rust-lang/rust', 'nicbell/rustc', 'nicbell/cargo',
  'nicbell/rustup', 'rust-lang/rustup', 'nicbell/rust-analyzer',
  'rust-analyzer/rust-analyzer', 'nicbell/clippy', 'nicbell/rustfmt',
  'actix/actix-web', 'nicbell/rocket', 'SergioBenitez/Rocket',
  'nicbell/warp', 'seanmonstar/warp', 'nicbell/tide',
  'http-rs/tide', 'nicbell/poem', 'poem-web/poem',
  'nicbell/reqwest', 'seanmonstar/reqwest', 'nicbell/surf',
  'http-rs/surf', 'nicbell/ureq', 'algesten/ureq',
  'rayon-rs/rayon', 'crossbeam-rs/crossbeam', 'Amanieu/parking_lot',
  'nicbell/rand', 'rust-random/rand', 'nicbell/regex',
  'rust-lang/regex', 'nicbell/chrono', 'chronotope/chrono',
  'nicbell/uuid', 'uuid-rs/uuid', 'nicbell/url',
  'servo/rust-url', 'nicbell/serde', 'nicbell/serde_json',

  // PHP (if we don't have many)
  'laravel/laravel', 'laravel/framework', 'laravel/lumen',
  'symfony/symfony', 'symfony/console', 'symfony/http-foundation',
  'composer/composer', 'phpunit/phpunit', 'mockery/mockery',
  'guzzle/guzzle', 'guzzle/psr7', 'php-fig/http-message',
  'doctrine/orm', 'doctrine/dbal', 'doctrine/migrations',
  'filp/whoops', 'monolog/monolog', 'vlucas/phpdotenv',
  'nikic/PHP-Parser', 'phpstan/phpstan', 'vimeo/psalm',

  // Ruby
  'rails/rails', 'sinatra/sinatra', 'hanami/hanami',
  'rspec/rspec', 'teamcapybara/capybara', 'thoughtbot/factory_bot',
  'rubocop/rubocop', 'ruby/ruby', 'jekyll/jekyll',
  'discourse/discourse', 'mastodon/mastodon', 'forem/forem',
  'heartcombo/devise', 'plataformatec/devise', 'bkeepers/dotenv',
  'puma/puma', 'sidekiq/sidekiq', 'mperham/sidekiq',
  'resque/resque', 'activeadmin/activeadmin', 'thoughtbot/administrate',
];

// Get existing repos
const existingRepos = new Set(
  readdirSync(TEST_REPOS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name.toLowerCase())
);

const existingLower = new Set([...existingRepos].map(r => r.toLowerCase().replace(/[^a-z0-9]/g, '')));

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '400');

console.log('='.repeat(60));
console.log('MORE REPOS - BATCH 2');
console.log('='.repeat(60));
console.log(`Current repos: ${existingRepos.size}`);
console.log(`Limit: ${limit}`);
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
  console.log('');
  console.log('Would clone:');
  toClone.slice(0, 50).forEach(r => console.log(`  ${r.name}`));
  if (toClone.length > 50) console.log(`  ... and ${toClone.length - 50} more`);
  process.exit(0);
}

console.log('');

let cloned = 0;
let failed = [];

for (const repo of toClone) {
  const repoPath = join(TEST_REPOS_DIR, repo.name);

  if (existsSync(repoPath)) {
    continue;
  }

  process.stdout.write(`[${cloned + 1}/${toClone.length}] ${repo.name}... `);

  try {
    execSync(`git clone --depth 1 ${repo.url} ${repoPath}`, {
      stdio: 'pipe',
      timeout: 120000
    });
    console.log('✓');
    cloned++;
  } catch (err) {
    console.log('✗');
    failed.push(repo.name);
  }
}

console.log('');
console.log('='.repeat(60));
console.log(`DONE: ${cloned} cloned, ${failed.length} failed`);
console.log('='.repeat(60));
