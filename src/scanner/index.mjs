// src/scanner/index.mjs
// Main scan orchestrator - thin layer that delegates to modules

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { loadKnowledge, getAllEntryPointAnnotations, getEntryPointFilePatterns } from '../knowledge/loader.mjs';
import { discoverFiles } from './discovery.mjs';
import { parseFile, isCodeFile, detectLanguage } from '../languages/index.mjs';
import { buildReachableFiles } from './graph.mjs';
import { extractPathAliases } from './resolver.mjs';
import { detectFrameworks, checkFrameworkEntry } from '../frameworks/index.mjs';

// Entry point patterns (files matching these are not dead)
const ENTRY_POINT_PATTERNS = [
  // Config files
  /\.(config|rc)(\.\w+)*\.([mc]?[jt]s|json)$/,
  // CI config files
  /dangerfile\.[jt]s$/,
  // Type declarations
  /\.d\.ts$/,
  // Test files
  /\.(test|spec)(\.\w+)*\.([mc]?[jt]s|[jt]sx)$/,
  /\.test-d\.([mc]?[jt]s|[jt]sx)$/,
  /\.cy\.([jt]s|[jt]sx)$/, // Cypress component tests
  /\.unit\.([mc]?[jt]s|[jt]sx)$/, // Unit test files
  /__tests__\/[^/]+\.([mc]?[jt]s|[jt]sx)$/,
  /__mocks__\//,
  // Build outputs
  /\/dist\//, /^dist\//, /\/build\//, /^build\//, /\/out\//, /^out\//,
  /\.min\.js$/,
  // File-based routing (Next.js, Remix, SvelteKit)
  /^pages\//, /^src\/pages\//, /^app\//, /^src\/app\//, /^routes\//, /^src\/routes\//,
  /^apps\/[^/]+\/pages\//, /^apps\/[^/]+\/app\//,
  // Scripts & bin
  /\/scripts?\//, /^scripts?\//, /\/bin\//, /^bin\//,
  // Entry files
  /^(index|main|server|app)\.([mc]?[jt]s|[jt]sx)$/,
  /^src\/(index|main|server|app)\.([mc]?[jt]s|[jt]sx)$/,
  // Workers
  /\.worker\.([mc]?[jt]s|[jt]sx)$/, /workers?\//,
  // Templates & fixtures
  /\/templates?\//, /\/fixtures\//, /^fixtures\//, /__fixtures__\//,
  // Storybook and visual testing
  /\.stories\.([mc]?[jt]s|[jt]sx)$/,
  /\/chromatic\//, /^chromatic\//,
  // Vitest/Playwright/Jest config
  /vitest\.workspace\.[mc]?[jt]s$/, /vitest\.config\.[mc]?[jt]s$/,
  /playwright\.config\.[mc]?[jt]s$/,
  /global-setup\.[mc]?[jt]s$/, /global-teardown\.[mc]?[jt]s$/,
  /\/reporters\//, /test-utils\//,
  // Plugins, extensions, addons & dynamic loading conventions
  /\/plugins?\//, /^plugins?\//, /\/extensions?\//, /^extensions?\//, /\/addons?\//, /^addons?\//,
  /\.plugin\.([mc]?[jt]s|tsx)$/, /\.node\.([mc]?[jt]s|tsx)$/,
  /\.credentials\.([mc]?[jt]s|tsx)$/,
  /\.connector\.([mc]?[jt]s|tsx)$/, /\.adapter\.([mc]?[jt]s|tsx)$/,
  /\/connectors?\//, /\/adapters?\//,
  /\/integrations?\//, /^integrations?\//,
  /\/providers?\//,
  /\/commands?\//, /^commands?\//,
  /\/nodes\//, /^nodes\//,
  // Migrations & seeds
  /\/migrations\//, /\/seeds?\//,
  // Tests (multi-language)
  /\/tests?\//, /^tests?\//,
  /\/specs?\//, /^specs?\//,   // Test directories (spec, specs)
  /\/e2e\//, /e2e-tests?\//, /__checks__\//, /\/intTest\//, /^intTest\//,
  // Deprecated packages (kept for backwards compatibility)
  /deprecated-packages?\//, /\/deprecated\//,
  // Benchmarks and performance testing
  /\/benchmarks?\//, /^benchmarks?\//,
  /smoke-test/, /performance-test/,
  // Docker/CI scripts
  /docker.*\.sh$/, /\.dockerfile$/i,
  // Kubernetes/deployment patterns
  /\/hack\//, /^hack\//, /\/cluster\//, /^cluster\//,
  /\/staging\//, /^staging\//,
  // Serverless functions
  /\/netlify\//, /^netlify\//, /\/vercel\//, /^vercel\//,
  /\/lambda\//, /^lambda\//, /\/functions\//, /^functions\//,
  // Codemods (standalone transformation scripts)
  /\/codemods?\//, /^codemods?\//, /-codemod\//, /codemod/,
  // Internal runtime/cache directories (build system files)
  /\/cache-dir\//, /\/internal-plugins\//,
  // Frontend static/app directories (webpack/vite entry points)
  /\/static\/app\//, /^static\/app\//, /\/static\/gs/, /^static\/gs/,
  // Ember.js frontend directories (convention-based loading)
  /frontend\/[^/]+\/app\//, /frontend\/discourse/,
  // Server-side rendering builds (conditional exports)
  /\/server\//, /^server\//,
  // Native bindings (compiled, not imported)
  /\/bindings\//, /^bindings\//,
  // Generated/vendored code patterns
  /\/@generated\//, /\/_generated\//, /\/generated\//,
  // Examples, samples, debug, and documentation
  /\/examples?\//, /^examples?\//,
  /\/samples(-dev)?\//, /^samples(-dev)?\//,
  /\/debug\//, /^debug\//,
  /\/docs?\//, /^docs?\//, /-docs\//, /_docs\//,
  /\/documentation\//, /^documentation\//,
  /\/recipes\//, /^recipes\//,
  // Build tools and generators
  /\/tools\//, /^tools\//,
  /\/generator\//, /\.generator\.[jt]s$/,
  // Dynamic loading directories
  /\/composables?\//, /\/stores\//, /\/routers?\//,
  // Enterprise modules & backend modules
  /\/ee\//, /\/enterprise\//,
  /\/modules?\//,
  // NestJS patterns
  /\.controller\.([mc]?[jt]s|tsx)$/, /\.handler\.([mc]?[jt]s|tsx)$/,
  // Pinia/Vuex stores
  /\.store\.([mc]?[jt]s|tsx)$/,
  // Schema files
  /\/schemas?\//, /\/schema\//,
  // Post-build scripts
  /^post[a-z]+\.(c|m)?js$/, /\/post[a-z]+\.(c|m)?js$/,
  // Containers (Docker/test infrastructure)
  /\/containers\//,
  // Public assets
  /\/public\//, /^public\//,
  // Python entry points
  /manage\.py$/, /wsgi\.py$/, /asgi\.py$/, /settings\.py$/, /urls\.py$/,
  /admin\.py$/, /models\.py$/, /views\.py$/, /serializers\.py$/,
  /__init__\.py$/, /conftest\.py$/, /test_[^/]+\.py$/, /tasks\.py$/,
  /\/management\/commands\//, /\/templatetags\//,
  /main\.py$/, /app\.py$/, /router\.py$/, /routes\.py$/,
  // Java/Kotlin entry points
  /Application\.(java|kt)$/, /.*Test\.(java|kt)$/, /.*Tests\.(java|kt)$/,
  /.*IT\.(java|kt)$/, /package-info\.java$/, /META-INF\//,
  // Go entry points
  /main\.go$/, /_test\.go$/, /wire\.go$/, /doc\.go$/,
  // Monorepo patterns
  /^packages\/[^/]+\/src\/(index|main)\.([mc]?[jt]s|[jt]sx)$/,
  /^packages\/@[^/]+\/[^/]+\/src\/(index|main)\.([mc]?[jt]s|[jt]sx)$/,
  /^libs\/[^/]+\/src\/(index|main)\.([mc]?[jt]s|[jt]sx)$/,
  // Dynamic loading: code editors, syntax highlighters
  /\/mode\/[^/]+\.js$/, /\/modes?\//, /^modes?\//,
  /\/languages?\/[^/]+\.(js|ts)$/, /\/lang\//, /^lang\//,
  /\/themes?\//, /^themes?\//,
  /\/grammars?\//, /^grammars?\//,
  // Icon and illustration libraries (dynamically loaded by name)
  /\/icons?\//, /-icons-/, /icons-material/,
  /\/illustrations?\//, /spectrum-illustrations/,
  // PHP entry points
  /index\.php$/, /artisan$/, /composer\.json$/,
  /app\/Http\/Controllers\//, /app\/Models\//, /app\/Providers\//,
  /routes\/web\.php$/, /routes\/api\.php$/,
  /database\/migrations\//, /database\/seeders\//,
  /config\/.*\.php$/, /resources\/views\//,
  // Ruby entry points
  /config\.ru$/, /Rakefile$/, /Gemfile$/,
  /\/homebrew\//, /^homebrew\//, /\.rb$.*homebrew/,
  // Rails config and migrations
  /config\/initializers\//, /config\/environments\//,
  /db\/post_migrate\//, /db\/migrate\//,
  /app\/controllers\//, /app\/models\//, /app\/helpers\//,
  /app\/jobs\//, /app\/mailers\//, /app\/views\//,
  /config\/routes\.rb$/, /config\/application\.rb$/,
  /db\/migrate\//, /db\/seeds\.rb$/,
  /lib\/tasks\/.*\.rake$/,
  /spec\/.*_spec\.rb$/, /test\/.*_test\.rb$/,
  // Rust entry points
  /^src\/main\.rs$/, /^src\/lib\.rs$/, /^src\/bin\/[^/]+\.rs$/,
  /Cargo\.toml$/, /build\.rs$/,
  /benches\/.*\.rs$/, /examples\/.*\.rs$/,
  // Rust test data and inline module submodules
  /\/test_data\//, /\/test-data\//, /\/testdata\//,
  /\/fuzz_targets\/[^/]+\.rs$/,  // Fuzz test targets
  // Common Rust inline module submodule directories
  /\/handlers\/[^/]+\.rs$/,
  /\/imports\/[^/]+\.rs$/,
  /\/syntax_helpers\/[^/]+\.rs$/,
  /\/completions\/[^/]+\.rs$/,
  /\/tracing\/[^/]+\.rs$/,
  /\/toolchain_info\/[^/]+\.rs$/,
  // Gradle/Groovy build files (build config, not dead code)
  /build\.gradle(\.kts)?$/, /settings\.gradle(\.kts)?$/,
  /\/buildSrc\//, /^buildSrc\//,
  /gradle\/.*\.gradle(\.kts)?$/,
  /Jenkinsfile$/,
  // Makefile and CMake (build config)
  /Makefile$/, /makefile$/, /CMakeLists\.txt$/,
  // C/C++ extension source directories (Python, Ruby, Node native modules)
  /\/src\/.*\.(c|cpp|h|hpp)$/, /\/_core\/.*\.(c|cpp|h|hpp)$/,
  /\/code_generators\//, /\/include\/.*\.(h|hpp)$/,
  // Elixir entry points
  /mix\.exs$/, /config\/.*\.exs$/,
  // Haskell entry points
  /\.cabal$/, /stack\.yaml$/, /Setup\.hs$/,
  // Nim entry points
  /\.nimble$/,
  // Zig entry points (build.zig compiles these, not imported by JS)
  /build\.zig$/, /\.zig$/
];

/**
 * Main scan function
 */
export async function scan(projectPath, options = {}) {
  const { onProgress = () => {}, config = {} } = options;

  // Load knowledge base
  await loadKnowledge();

  // Compile knowledge-base file patterns into RegExp objects
  const knowledgeFilePatterns = getEntryPointFilePatterns().map(p => ({
    ...p,
    regex: new RegExp(p.pattern)
  }));

  onProgress({ phase: 'discovery', message: 'Discovering files...' });

  // Phase 1: Discover files
  const files = discoverFiles(projectPath, {
    onProgress: (count) => onProgress({ phase: 'discovery', filesFound: count })
  });

  onProgress({ phase: 'parsing', message: `Parsing ${files.length} files...`, total: files.length });

  // Phase 2: Parse all files
  const parsedFiles = [];
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];

    if (i % 10 === 0) {
      onProgress({ phase: 'parsing', current: i, total: files.length });
    }

    try {
      const fullPath = join(projectPath, filePath);
      const content = readFileSync(fullPath, 'utf-8');
      const result = await parseFile(filePath, content);

      if (result) {
        parsedFiles.push({
          relativePath: filePath,
          ...result,
          size: content.length,
          lines: content.split('\n').length,
          content // Keep for re-export chain following
        });
      }
    } catch {
      // Skip files that can't be read/parsed
    }
  }

  onProgress({ phase: 'analysis', message: 'Building dependency graph...' });

  // Phase 3: Identify entry points
  const entryPointFiles = new Set();
  const entryPointReasons = [];

  // Package.json entry points
  const rootPkgPath = join(projectPath, 'package.json');
  let packageJson = {};
  if (existsSync(rootPkgPath)) {
    try { packageJson = JSON.parse(readFileSync(rootPkgPath, 'utf-8')); } catch {}
  }

  // Script entry points from package.json
  const scriptEntries = extractScriptEntryPoints(packageJson, projectPath);
  for (const ep of scriptEntries) {
    entryPointFiles.add(ep);
    entryPointReasons.push({ file: ep, reason: 'package.json entry' });
  }

  // HTML entry points (project root)
  const htmlEntries = extractHtmlEntryPoints(projectPath);
  for (const ep of htmlEntries) entryPointFiles.add(ep);

  // Vite config resolve.alias replacement entry points (project root)
  const viteReplacementEntries = extractViteReplacementEntryPoints(projectPath);
  for (const ep of viteReplacementEntries) {
    entryPointFiles.add(ep);
    entryPointReasons.push({ file: ep, reason: 'Vite resolve.alias replacement' });
  }

  // Nested package.json entry points (for sub-packages like editors/code/)
  const nestedPkgEntries = extractNestedPackageEntryPoints(projectPath, parsedFiles);
  for (const ep of nestedPkgEntries) {
    entryPointFiles.add(ep.file);
    entryPointReasons.push({ file: ep.file, reason: ep.reason });
  }

  // Build config entry points (rollup, webpack, vite, esbuild)
  const buildConfigEntries = extractBuildConfigEntryPoints(projectPath);
  for (const ep of buildConfigEntries) {
    // Try to match with actual files (with extension resolution)
    const epNoExt = ep.replace(/\.([mc]?[jt]s|[jt]sx)$/, '');
    for (const file of parsedFiles) {
      const fp = file.relativePath;
      const fpNoExt = fp.replace(/\.([mc]?[jt]s|[jt]sx)$/, '');
      if (fp === ep || fpNoExt === epNoExt || fp === ep + '/index.js' || fp === ep + '/index.ts') {
        entryPointFiles.add(fp);
        entryPointReasons.push({ file: fp, reason: 'Build config entry' });
        break;
      }
    }
  }

  // Cargo.toml entry points (Rust)
  const cargoEntries = extractCargoEntryPoints(projectPath);
  for (const ep of cargoEntries) {
    if (ep.endsWith('/')) {
      // Directory marker - mark all files in this directory as entry points
      for (const file of parsedFiles) {
        if (file.relativePath.startsWith(ep)) {
          entryPointFiles.add(file.relativePath);
          entryPointReasons.push({ file: file.relativePath, reason: 'Cargo.toml autoload' });
        }
      }
    } else {
      entryPointFiles.add(ep);
      entryPointReasons.push({ file: ep, reason: 'Cargo.toml entry' });
    }
  }

  // composer.json entry points (PHP)
  const composerEntries = extractComposerEntryPoints(projectPath);
  for (const ep of composerEntries) {
    if (ep.endsWith('/')) {
      // Directory marker - mark all files in this directory as entry points
      for (const file of parsedFiles) {
        if (file.relativePath.startsWith(ep)) {
          entryPointFiles.add(file.relativePath);
          entryPointReasons.push({ file: file.relativePath, reason: 'Composer autoload' });
        }
      }
    } else {
      entryPointFiles.add(ep);
      entryPointReasons.push({ file: ep, reason: 'Composer entry' });
    }
  }

  // Gemfile/gemspec entry points (Ruby)
  const gemEntries = extractGemEntryPoints(projectPath);
  for (const ep of gemEntries) {
    if (ep.endsWith('/')) {
      // Directory marker
      for (const file of parsedFiles) {
        if (file.relativePath.startsWith(ep)) {
          entryPointFiles.add(file.relativePath);
          entryPointReasons.push({ file: file.relativePath, reason: 'Gem autoload' });
        }
      }
    } else {
      entryPointFiles.add(ep);
      entryPointReasons.push({ file: ep, reason: 'Gem entry' });
    }
  }

  // Workspace package entry points - mark each workspace package's entry file
  const { workspacePackages: wsPkgs } = extractPathAliases(projectPath);

  // HTML entry points, vite replacement entry points, and script entry points in workspace packages
  for (const [pkgName, pkg] of wsPkgs) {
    const wsHtmlEntries = extractHtmlEntryPoints(join(projectPath, pkg.dir), pkg.dir);
    for (const ep of wsHtmlEntries) {
      entryPointFiles.add(ep);
      entryPointReasons.push({ file: ep, reason: 'HTML script entry' });
    }
    const wsViteEntries = extractViteReplacementEntryPoints(join(projectPath, pkg.dir), pkg.dir);
    for (const ep of wsViteEntries) {
      entryPointFiles.add(ep);
      entryPointReasons.push({ file: ep, reason: 'Vite resolve.alias replacement' });
    }
    // Script entry points from workspace package.json
    const wsPkgJsonPath = join(projectPath, pkg.dir, 'package.json');
    if (existsSync(wsPkgJsonPath)) {
      try {
        const wsPkgJson = JSON.parse(readFileSync(wsPkgJsonPath, 'utf-8'));
        const wsScriptEntries = extractScriptEntryPoints(wsPkgJson, join(projectPath, pkg.dir));
        for (const ep of wsScriptEntries) {
          const fullPath = `${pkg.dir}/${ep}`;
          entryPointFiles.add(fullPath);
          entryPointReasons.push({ file: fullPath, reason: `Workspace script entry: ${pkgName}` });
        }
      } catch {}
    }
  }
  for (const [pkgName, pkg] of wsPkgs) {
    const entryFile = `${pkg.dir}/${pkg.entryPoint}`;
    // Try to match against actual parsed files (with extension resolution)
    const entryNoExt = entryFile.replace(/\.([mc]?[jt]s|[jt]sx)$/, '');
    for (const file of parsedFiles) {
      const fp = file.relativePath;
      const fpNoExt = fp.replace(/\.([mc]?[jt]s|[jt]sx)$/, '');
      if (fp === entryFile || fpNoExt === entryNoExt) {
        entryPointFiles.add(fp);
        entryPointReasons.push({ file: fp, reason: `Workspace package entry: ${pkgName}` });
        break;
      }
    }
    // Mark workspace bin files as entry points
    for (const binPath of pkg.binFiles || []) {
      const binFile = `${pkg.dir}/${binPath}`;
      for (const file of parsedFiles) {
        if (file.relativePath === binFile) {
          entryPointFiles.add(file.relativePath);
          entryPointReasons.push({ file: file.relativePath, reason: `Workspace bin: ${pkgName}` });
          break;
        }
      }
    }
    // Also check exports map for additional entry points
    if (pkg.exportsMap) {
      for (const [, exportPath] of pkg.exportsMap) {
        const expFile = `${pkg.dir}/${exportPath}`;
        const expNoExt = expFile.replace(/\.([mc]?[jt]s|[jt]sx)$/, '');
        for (const file of parsedFiles) {
          const fp = file.relativePath;
          const fpNoExt = fp.replace(/\.([mc]?[jt]s|[jt]sx)$/, '');
          if (fp === expFile || fpNoExt === expNoExt) {
            entryPointFiles.add(fp);
            entryPointReasons.push({ file: fp, reason: `Workspace export: ${pkgName}` });
            break;
          }
        }
      }
    }
  }

  // Pattern-based entry points
  for (const file of parsedFiles) {
    const filePath = file.relativePath;
    if (!isCodeFile(filePath)) continue;

    // Check metadata-based entry points
    const meta = file.metadata;
    if (meta) {
      // Python
      if (meta.hasMainBlock || meta.isCelery) {
        entryPointFiles.add(filePath);
        entryPointReasons.push({ file: filePath, reason: meta.hasMainBlock ? 'Has __main__ block' : 'Celery task' });
        continue;
      }
      // Java
      if (meta.hasMainMethod || meta.isSpringComponent) {
        entryPointFiles.add(filePath);
        entryPointReasons.push({ file: filePath, reason: meta.hasMainMethod ? 'Has main()' : 'Spring component' });
        continue;
      }
      // Java annotations
      if (file.annotations?.length > 0) {
        const entryAnnotations = new Set(getAllEntryPointAnnotations('java').map(a => a.name));
        const matched = file.annotations.find(a => entryAnnotations.has(a.name));
        if (matched) {
          entryPointFiles.add(filePath);
          entryPointReasons.push({ file: filePath, reason: `@${matched.name} annotation` });
          continue;
        }
      }
      // Go
      if (meta.isMainPackage && meta.hasMainFunction) {
        entryPointFiles.add(filePath);
        entryPointReasons.push({ file: filePath, reason: 'Go main package' });
        continue;
      }
      if (meta.hasInitFunction) {
        entryPointFiles.add(filePath);
        entryPointReasons.push({ file: filePath, reason: 'Go init()' });
        continue;
      }
      if (meta.isTestFile) {
        entryPointFiles.add(filePath);
        entryPointReasons.push({ file: filePath, reason: 'Go test file' });
        continue;
      }
    }

    // DI decorator check
    const fileClasses = file.classes || [];
    for (const cls of fileClasses) {
      if (cls.decorators?.length > 0) {
        const diNames = new Set([
          'Controller', 'Module', 'Resolver', 'Service', 'Injectable',
          'RestController', 'Entity', 'Get', 'Post', 'Put', 'Delete', 'Patch',
          'Component', 'Repository', 'Configuration', 'Bean', 'Aspect',
          'ApiController', 'BackendModule', 'Middleware', 'Guard', 'Interceptor',
          'Pipe', 'Filter', 'WebSocketGateway', 'EventPattern', 'MessagePattern'
        ]);
        const matched = cls.decorators.find(d => diNames.has(d.name));
        if (matched) {
          entryPointFiles.add(filePath);
          entryPointReasons.push({ file: filePath, reason: `@${matched.name} decorator` });
          break;
        }
      }
    }

    // Pattern-based entry point check
    if (!entryPointFiles.has(filePath)) {
      for (const pattern of ENTRY_POINT_PATTERNS) {
        if (pattern.test(filePath)) {
          entryPointFiles.add(filePath);
          entryPointReasons.push({ file: filePath, reason: `Matches pattern: ${pattern.source.slice(0, 40)}` });
          break;
        }
      }
    }

    // Knowledge-base file patterns (loaded from entry-points.json)
    if (!entryPointFiles.has(filePath)) {
      for (const kbPattern of knowledgeFilePatterns) {
        if (kbPattern.regex.test(filePath)) {
          entryPointFiles.add(filePath);
          entryPointReasons.push({ file: filePath, reason: kbPattern.reason || `Knowledge pattern: ${kbPattern.id}` });
          break;
        }
      }
    }
  }

  // Framework-specific entry points
  const detectedFrameworks = detectFrameworks(projectPath);
  for (const file of parsedFiles) {
    const filePath = file.relativePath;
    if (entryPointFiles.has(filePath)) continue;
    if (checkFrameworkEntry(filePath, detectedFrameworks)) {
      entryPointFiles.add(filePath);
      entryPointReasons.push({ file: filePath, reason: 'Framework entry pattern' });
    }
  }

  // DI container class reference detection
  // When a class is referenced via Container.get(ClassName), the file defining that class is alive
  const classToFile = new Map();
  for (const file of parsedFiles) {
    for (const cls of file.classes || []) {
      if (cls.name) classToFile.set(cls.name, file.relativePath);
    }
  }
  const diReferencedClasses = new Set();
  const diContainerPattern = /(?:Container|Injector|container|injector)\s*\.\s*(?:get|resolve|create|obtain)\s*\(\s*(\w+)/g;
  const diDecoratePattern = /@(?:Inject|LazyService|ServiceToken)\s*\(\s*(\w+)/g;
  for (const file of parsedFiles) {
    const content = file.content || '';
    let match;
    const diRegexes = [diContainerPattern, diDecoratePattern];
    for (const regex of diRegexes) {
      regex.lastIndex = 0;
      while ((match = regex.exec(content)) !== null) {
        diReferencedClasses.add(match[1]);
      }
    }
  }
  for (const className of diReferencedClasses) {
    const filePath = classToFile.get(className);
    if (filePath && !entryPointFiles.has(filePath)) {
      entryPointFiles.add(filePath);
      entryPointReasons.push({ file: filePath, reason: `DI container: ${className}` });
    }
  }

  // Workspace export subpath entry points
  // Mark files targeted by workspace package exports as entry points
  // This ensures files like @n8n/rest-api-client/src/api/execution.ts are alive
  // when the package exports ./api/execution
  for (const [pkgName, pkg] of wsPkgs) {
    if (!pkg.exportsMap) continue;
    for (const [subpath, rawPath] of pkg.exportsMap) {
      // Try dist→src conversion candidates
      const candidates = [rawPath];
      if (/^dist\//.test(rawPath)) {
        candidates.push(rawPath.replace(/^dist\//, 'src/'));
        candidates.push(rawPath.replace(/^dist\//, ''));
      }
      if (/\/dist\//.test(rawPath)) {
        candidates.push(rawPath.replace(/\/dist\//, '/src/'));
        candidates.push(rawPath.replace(/\/dist\//, '/'));
      }
      for (const candidate of candidates) {
        const fullPath = `${pkg.dir}/${candidate}`;
        const noExt = fullPath.replace(/\.([mc]?[jt]s|[jt]sx)$/, '');
        for (const file of parsedFiles) {
          const fp = file.relativePath;
          const fpNoExt = fp.replace(/\.([mc]?[jt]s|[jt]sx)$/, '');
          if (fp === fullPath || fpNoExt === noExt || fpNoExt === fullPath + '/index' || fpNoExt === noExt + '/index') {
            if (!entryPointFiles.has(fp)) {
              entryPointFiles.add(fp);
              entryPointReasons.push({ file: fp, reason: `Workspace export: ${pkgName}/${subpath}` });
            }
          }
        }
      }
    }
  }

  // Dynamic package.json field extraction (nodes, credentials, plugins, etc.)
  // Scan workspace package.json files for declared entry points
  const dynamicFields = ['nodes', 'credentials', 'plugins', 'extensions', 'adapters', 'connectors'];
  for (const [, pkg] of wsPkgs) {
    const pkgJsonPath = join(projectPath, pkg.dir, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    try {
      const wsPkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      const dynamicPaths = extractDynamicFieldPaths(wsPkg, dynamicFields);
      for (const dp of dynamicPaths) {
        // Convert dist paths to source paths
        const sourcePath = dp.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
        const candidates = [
          `${pkg.dir}/${dp}`,
          `${pkg.dir}/${sourcePath}`,
          `${pkg.dir}/${dp.replace(/\.js$/, '')}`,
          `${pkg.dir}/${sourcePath.replace(/\.ts$/, '')}`
        ];
        for (const file of parsedFiles) {
          const fp = file.relativePath;
          if (entryPointFiles.has(fp)) continue;
          for (const candidate of candidates) {
            const candidateNoExt = candidate.replace(/\.([mc]?[jt]s|[jt]sx)$/, '');
            const fpNoExt = fp.replace(/\.([mc]?[jt]s|[jt]sx)$/, '');
            if (fp === candidate || fpNoExt === candidateNoExt) {
              entryPointFiles.add(fp);
              entryPointReasons.push({ file: fp, reason: 'Dynamic package.json field' });
              break;
            }
          }
        }
      }
    } catch {}
  }

  // Phase 4: Build reachability graph
  onProgress({ phase: 'graph', message: 'Building reachability graph...' });
  const reachableFiles = buildReachableFiles(entryPointFiles, parsedFiles, projectPath);

  // Phase 5: Find dead files
  onProgress({ phase: 'detection', message: 'Detecting dead code...' });
  const deadFiles = [];
  let totalDeadBytes = 0;

  for (const file of parsedFiles) {
    const filePath = file.relativePath;
    if (!isCodeFile(filePath)) continue;
    if (entryPointFiles.has(filePath)) continue;
    if (reachableFiles.has(filePath)) continue;

    // Skip empty files (nothing to analyse, not meaningful dead code)
    if (!file.content || file.content.trim() === '') continue;

    deadFiles.push({
      file: filePath,
      size: file.size,
      lines: file.lines,
      language: detectLanguage(filePath),
      exports: (file.exports || []).map(e => ({ name: e.name, type: e.type }))
    });
    totalDeadBytes += file.size;
  }

  // Sort by size
  deadFiles.sort((a, b) => b.size - a.size);

  const totalFiles = parsedFiles.filter(f => isCodeFile(f.relativePath)).length;
  const deadRate = totalFiles > 0 ? ((deadFiles.length / totalFiles) * 100).toFixed(2) : '0.00';

  return {
    deadFiles,
    entryPoints: entryPointReasons,
    summary: {
      totalFiles,
      entryPoints: entryPointFiles.size,
      reachableFiles: reachableFiles.size,
      deadFiles: deadFiles.length,
      deadRate: `${deadRate}%`,
      totalDeadBytes,
      languages: {
        javascript: parsedFiles.filter(f => detectLanguage(f.relativePath) === 'javascript').length,
        python: parsedFiles.filter(f => detectLanguage(f.relativePath) === 'python').length,
        go: parsedFiles.filter(f => detectLanguage(f.relativePath) === 'go').length,
        java: parsedFiles.filter(f => detectLanguage(f.relativePath) === 'java').length,
        php: parsedFiles.filter(f => detectLanguage(f.relativePath) === 'php').length,
        ruby: parsedFiles.filter(f => detectLanguage(f.relativePath) === 'ruby').length,
        rust: parsedFiles.filter(f => detectLanguage(f.relativePath) === 'rust').length
      }
    }
  };
}

function extractScriptEntryPoints(packageJson, projectPath) {
  const entryPoints = new Set();

  // 1. Scripts field
  const scripts = packageJson.scripts || {};
  for (const scriptCmd of Object.values(scripts)) {
    if (!scriptCmd) continue;
    const patterns = [
      /(?:node|tsx|ts-node)\s+([^\s&|;]+\.(?:[mc]?[jt]s|[jt]sx))/gi,
      /(?:^|\s)(\.?\.?\/[^\s&|;]+\.(?:[mc]?[jt]s|[jt]sx))/gi
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(scriptCmd)) !== null) {
        entryPoints.add(match[1].replace(/^\.\//, ''));
      }
    }
  }

  // 2. bin field — follow imports from bin files to find real entry points
  const bin = packageJson.bin;
  if (bin) {
    const binPaths = typeof bin === 'string' ? [bin] : Object.values(bin);
    for (const binPath of binPaths) {
      if (!binPath) continue;
      const normalised = binPath.replace(/^\.\//, '');
      // Read the bin file and extract its imports
      try {
        const fullPath = join(projectPath, normalised);
        const content = readFileSync(fullPath, 'utf-8');
        const importPatterns = [
          /import\s+['"]([^'"]+)['"]/g,
          /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
          /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
        ];
        for (const pat of importPatterns) {
          let m;
          while ((m = pat.exec(content)) !== null) {
            let target = m[1];
            if (target.startsWith('.')) {
              // Resolve relative to bin file location
              const binDir = normalised.includes('/') ? normalised.slice(0, normalised.lastIndexOf('/')) : '';
              target = join(binDir, target).replace(/\\/g, '/').replace(/^\.\//, '');
            }
            entryPoints.add(target);
          }
        }
      } catch {}
    }
  }

  // 3. main, module fields
  for (const field of ['main', 'module']) {
    if (packageJson[field]) {
      entryPoints.add(packageJson[field].replace(/^\.\//, ''));
    }
  }

  // 4. exports field
  const exports = packageJson.exports;
  if (exports) {
    const extractExportPaths = (obj) => {
      if (typeof obj === 'string') {
        entryPoints.add(obj.replace(/^\.\//, ''));
      } else if (obj && typeof obj === 'object') {
        for (const val of Object.values(obj)) {
          extractExportPaths(val);
        }
      }
    };
    extractExportPaths(exports);
  }

  return entryPoints;
}

function extractHtmlEntryPoints(projectPath, prefix = '') {
  const entryPoints = new Set();
  if (!projectPath) return entryPoints;

  // Direct HTML files to check
  const htmlFiles = ['index.html', 'public/index.html', 'src/index.html'];

  // Also scan layout directories (Jekyll, Hugo, etc.)
  const layoutDirs = ['_layouts', '_includes', 'layouts', 'templates', 'views'];

  function scanHtmlFile(htmlPath) {
    try {
      const content = readFileSync(htmlPath, 'utf-8');
      // Match script src with JS/TS extensions
      const scriptPattern = /<script[^>]*\ssrc=["']([^"']+\.(?:[mc]?[jt]s|[jt]sx))["'][^>]*>/gi;
      let match;
      while ((match = scriptPattern.exec(content)) !== null) {
        let src = match[1];
        // Remove template variable prefixes like {{ root }}, {{ site.baseurl }}, etc.
        src = src.replace(/\{\{[^}]*\}\}/g, '').replace(/\{%[^%]*%\}/g, '');
        if (src.startsWith('/')) src = src.slice(1);
        else if (src.startsWith('./')) src = src.slice(2);
        // Skip external URLs and empty paths
        if (src.startsWith('http') || src.startsWith('//') || !src) continue;
        entryPoints.add(prefix ? `${prefix}/${src}` : src);
      }
    } catch {}
  }

  // Scan direct HTML files
  for (const htmlFile of htmlFiles) {
    scanHtmlFile(join(projectPath, htmlFile));
  }

  // Scan layout directories
  for (const layoutDir of layoutDirs) {
    const layoutPath = join(projectPath, layoutDir);
    if (!existsSync(layoutPath)) continue;
    try {
      const files = readdirSync(layoutPath);
      for (const file of files) {
        if (file.endsWith('.html') || file.endsWith('.liquid') || file.endsWith('.erb')) {
          scanHtmlFile(join(layoutPath, file));
        }
      }
    } catch {}
  }

  // Also check docs directory layouts (common in documentation sites)
  const docsLayoutDirs = ['docs/_layouts', 'docs/_includes', 'site/_layouts'];
  for (const layoutDir of docsLayoutDirs) {
    const layoutPath = join(projectPath, layoutDir);
    if (!existsSync(layoutPath)) continue;
    try {
      const files = readdirSync(layoutPath);
      for (const file of files) {
        if (file.endsWith('.html') || file.endsWith('.liquid') || file.endsWith('.erb')) {
          scanHtmlFile(join(layoutPath, file));
        }
      }
    } catch {}
  }

  return entryPoints;
}

/**
 * Extract file paths from dynamic package.json fields (nodes, credentials, plugins, etc.)
 * These are files declared in package.json that are loaded dynamically at runtime.
 */
function extractDynamicFieldPaths(pkgJson, fieldNames, maxDepth = 3) {
  const paths = [];
  const walk = (obj, depth) => {
    if (depth > maxDepth || !obj || typeof obj !== 'object') return;
    for (const [key, val] of Object.entries(obj)) {
      if (fieldNames.includes(key)) {
        // Found a matching field - extract paths from its value
        collectPaths(val, paths);
      } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        walk(val, depth + 1);
      }
    }
  };
  walk(pkgJson, 0);
  return paths;
}

function collectPaths(val, paths) {
  if (typeof val === 'string') {
    if (val.match(/\.[a-z]+$/i) || val.includes('/')) {
      paths.push(val.replace(/^\.\//, ''));
    }
  } else if (Array.isArray(val)) {
    for (const item of val) collectPaths(item, paths);
  } else if (val && typeof val === 'object') {
    for (const v of Object.values(val)) collectPaths(v, paths);
  }
}

/**
 * Extract entry points from vite.config resolve.alias replacement values.
 * Files used as alias replacements are loaded at build time and should be considered alive.
 */
function extractViteReplacementEntryPoints(dir, prefix = '') {
  const entryPoints = new Set();
  if (!dir) return entryPoints;
  const configNames = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'];
  for (const configName of configNames) {
    const configPath = join(dir, configName);
    if (!existsSync(configPath)) continue;
    try {
      const content = readFileSync(configPath, 'utf-8');
      // Match replacement values in resolve.alias entries
      // Patterns: replacement: resolve(__dirname, 'path/to/file')
      //           replacement: 'path/to/file'
      //           replacement: `${__dirname}/path/to/file`
      const replacementPatterns = [
        /replacement\s*:\s*(?:resolve\s*\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\))/g,
        /replacement\s*:\s*['"](\.[^'"]+)['"]/g
      ];
      for (const pattern of replacementPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          let filePath = match[1];
          // Skip node_modules and package names
          if (filePath.includes('node_modules') || !filePath.includes('/')) continue;
          // Normalise path
          if (filePath.startsWith('./')) filePath = filePath.slice(2);
          const entry = prefix ? `${prefix}/${filePath}` : filePath;
          entryPoints.add(entry);
        }
      }
    } catch {}
  }
  return entryPoints;
}

/**
 * Extract entry points from build tool configs (rollup, webpack, vite, esbuild)
 * These configs specify the source entry points that get compiled to dist/
 */
function extractBuildConfigEntryPoints(projectPath) {
  const entryPoints = new Set();

  // Rollup configs
  const rollupConfigs = [
    'rollup.config.js', 'rollup.config.mjs', 'rollup.config.ts',
    'build/rollup-config.js', 'build/rollup.config.js'
  ];
  for (const configFile of rollupConfigs) {
    const configPath = join(projectPath, configFile);
    if (!existsSync(configPath)) continue;
    try {
      const content = readFileSync(configPath, 'utf-8');
      // Match input field: input: './src/index.js' or input: { main: './src/main.js' }
      const inputPatterns = [
        /input\s*:\s*['"]([^'"]+)['"]/g,
        /input\s*:\s*\{[^}]*['"]([^'"]+)['"]/g,
        /input\s*:\s*\[[^\]]*['"]([^'"]+)['"]/g
      ];
      for (const pattern of inputPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          let entry = match[1];
          if (entry.startsWith('./')) entry = entry.slice(2);
          if (entry.startsWith('/')) entry = entry.slice(1);
          entryPoints.add(entry);
        }
      }
    } catch {}
  }

  // Webpack configs
  const webpackConfigs = [
    'webpack.config.js', 'webpack.config.ts', 'webpack.config.mjs',
    'webpack.common.js', 'webpack.prod.js', 'webpack.dev.js'
  ];
  for (const configFile of webpackConfigs) {
    const configPath = join(projectPath, configFile);
    if (!existsSync(configPath)) continue;
    try {
      const content = readFileSync(configPath, 'utf-8');
      // Match entry field
      const entryPatterns = [
        /entry\s*:\s*['"]([^'"]+)['"]/g,
        /entry\s*:\s*\{[^}]*:\s*['"]([^'"]+)['"]/g,
        /entry\s*:\s*\[[^\]]*['"]([^'"]+)['"]/g
      ];
      for (const pattern of entryPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          let entry = match[1];
          if (entry.startsWith('./')) entry = entry.slice(2);
          if (entry.startsWith('/')) entry = entry.slice(1);
          entryPoints.add(entry);
        }
      }
    } catch {}
  }

  // Vite configs
  const viteConfigs = [
    'vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.mts'
  ];
  for (const configFile of viteConfigs) {
    const configPath = join(projectPath, configFile);
    if (!existsSync(configPath)) continue;
    try {
      const content = readFileSync(configPath, 'utf-8');
      // Match build.rollupOptions.input or build.lib.entry
      const vitePatterns = [
        /input\s*:\s*['"]([^'"]+)['"]/g,
        /entry\s*:\s*['"]([^'"]+)['"]/g,
        /input\s*:\s*\{[^}]*['"]([^'"]+)['"]/g,
        /input\s*:\s*resolve\s*\([^)]*['"]([^'"]+)['"]\s*\)/g
      ];
      for (const pattern of vitePatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          let entry = match[1];
          if (entry.startsWith('./')) entry = entry.slice(2);
          if (entry.startsWith('/')) entry = entry.slice(1);
          entryPoints.add(entry);
        }
      }
    } catch {}
  }

  // Esbuild configs (usually in package.json scripts or esbuild.config.js)
  const esbuildConfigs = ['esbuild.config.js', 'esbuild.config.mjs', 'esbuild.mjs'];
  for (const configFile of esbuildConfigs) {
    const configPath = join(projectPath, configFile);
    if (!existsSync(configPath)) continue;
    try {
      const content = readFileSync(configPath, 'utf-8');
      // Match entryPoints field
      const esbuildPatterns = [
        /entryPoints\s*:\s*\[[^\]]*['"]([^'"]+)['"]/g,
        /entryPoints\s*:\s*\{[^}]*['"]([^'"]+)['"]/g
      ];
      for (const pattern of esbuildPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          let entry = match[1];
          if (entry.startsWith('./')) entry = entry.slice(2);
          if (entry.startsWith('/')) entry = entry.slice(1);
          entryPoints.add(entry);
        }
      }
    } catch {}
  }

  // Tsup configs
  const tsupConfigs = ['tsup.config.ts', 'tsup.config.js'];
  for (const configFile of tsupConfigs) {
    const configPath = join(projectPath, configFile);
    if (!existsSync(configPath)) continue;
    try {
      const content = readFileSync(configPath, 'utf-8');
      const tsupPatterns = [
        /entry\s*:\s*\[[^\]]*['"]([^'"]+)['"]/g,
        /entry\s*:\s*['"]([^'"]+)['"]/g
      ];
      for (const pattern of tsupPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          let entry = match[1];
          if (entry.startsWith('./')) entry = entry.slice(2);
          if (entry.startsWith('/')) entry = entry.slice(1);
          entryPoints.add(entry);
        }
      }
    } catch {}
  }

  return entryPoints;
}

/**
 * Extract entry points from Cargo.toml for Rust projects (including workspaces)
 */
function extractCargoEntryPoints(projectPath) {
  const entryPoints = new Set();

  // Process a single Cargo.toml
  function processCargoToml(cargoPath, prefix = '') {
    if (!existsSync(cargoPath)) return;

    try {
      const content = readFileSync(cargoPath, 'utf-8');
      const dir = cargoPath.replace(/Cargo\.toml$/, '');
      const relDir = dir.slice(projectPath.length + 1);

      // Default entry points for Rust
      const mainPath = join(dir, 'src/main.rs');
      const libPath = join(dir, 'src/lib.rs');
      if (existsSync(mainPath)) {
        entryPoints.add(relDir + 'src/main.rs');
      }
      if (existsSync(libPath)) {
        entryPoints.add(relDir + 'src/lib.rs');
      }

      // [[bin]] targets
      const binPattern = /\[\[bin\]\][^[]*?path\s*=\s*["']([^"']+)["']/g;
      let match;
      while ((match = binPattern.exec(content)) !== null) {
        entryPoints.add(relDir + match[1]);
      }

      // [[example]] targets
      const examplePattern = /\[\[example\]\][^[]*?path\s*=\s*["']([^"']+)["']/g;
      while ((match = examplePattern.exec(content)) !== null) {
        entryPoints.add(relDir + match[1]);
      }

      // [[bench]] targets
      const benchPattern = /\[\[bench\]\][^[]*?path\s*=\s*["']([^"']+)["']/g;
      while ((match = benchPattern.exec(content)) !== null) {
        entryPoints.add(relDir + match[1]);
      }

      // [lib] path
      const libMatch = content.match(/\[lib\][^[]*?path\s*=\s*["']([^"']+)["']/);
      if (libMatch) {
        entryPoints.add(relDir + libMatch[1]);
      }

      // [workspace] members - recursively process workspace members
      const membersMatch = content.match(/\[workspace\][^[]*members\s*=\s*\[([\s\S]*?)\]/);
      if (membersMatch) {
        const membersStr = membersMatch[1];
        const members = membersStr.match(/["']([^"']+)["']/g);
        if (members) {
          for (const member of members) {
            const memberPath = member.replace(/['"]/g, '');
            // Handle glob patterns like "crates/*"
            if (memberPath.includes('*')) {
              const basePath = memberPath.replace(/\/?\*.*$/, '');
              const memberDir = join(projectPath, basePath);
              if (existsSync(memberDir)) {
                try {
                  const subdirs = readdirSync(memberDir, { withFileTypes: true });
                  for (const subdir of subdirs) {
                    if (subdir.isDirectory()) {
                      const subCargoPath = join(memberDir, subdir.name, 'Cargo.toml');
                      processCargoToml(subCargoPath);
                    }
                  }
                } catch {}
              }
            } else {
              const memberCargoPath = join(projectPath, memberPath, 'Cargo.toml');
              processCargoToml(memberCargoPath);
            }
          }
        }
      }
    } catch {}
  }

  processCargoToml(join(projectPath, 'Cargo.toml'));

  // Also scan for nested Cargo.toml files that might not be workspace members
  // This handles cases like crates/foo/bar/Cargo.toml (nested crates)
  function scanForNestedCargo(dir, depth = 0) {
    if (depth > 5) return; // Limit recursion depth
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'target' || entry.name === '.git' || entry.name === 'node_modules') continue;
        const subdir = join(dir, entry.name);
        const cargoPath = join(subdir, 'Cargo.toml');
        if (existsSync(cargoPath)) {
          processCargoToml(cargoPath);
        }
        scanForNestedCargo(subdir, depth + 1);
      }
    } catch {}
  }
  scanForNestedCargo(projectPath);

  return entryPoints;
}

/**
 * Extract entry points from composer.json for PHP projects
 */
function extractComposerEntryPoints(projectPath) {
  const entryPoints = new Set();
  const composerPath = join(projectPath, 'composer.json');
  if (!existsSync(composerPath)) return entryPoints;

  try {
    const content = readFileSync(composerPath, 'utf-8');
    const composer = JSON.parse(content);

    // Autoload PSR-4
    const autoload = composer.autoload || {};
    const psr4 = autoload['psr-4'] || {};
    for (const [namespace, path] of Object.entries(psr4)) {
      // Mark the autoload directory as containing entry points
      const dir = Array.isArray(path) ? path[0] : path;
      if (typeof dir === 'string') {
        // Files in PSR-4 directories are autoloaded
        entryPoints.add(dir.replace(/\/$/, '') + '/');
      }
    }

    // Autoload files (explicitly loaded)
    const files = autoload.files || [];
    for (const file of files) {
      entryPoints.add(file);
    }

    // Bin scripts
    const bin = composer.bin || [];
    for (const binFile of (Array.isArray(bin) ? bin : [bin])) {
      entryPoints.add(binFile);
    }
  } catch {}

  return entryPoints;
}

/**
 * Extract entry points from nested package.json files (sub-packages)
 * Handles cases like VS Code extensions where main points to out/ but source is in src/
 */
function extractNestedPackageEntryPoints(projectPath, parsedFiles) {
  const entries = [];
  const addedPaths = new Set();

  // Find all package.json files by checking all ancestor directories of parsed files
  const checkedDirs = new Set();
  for (const file of parsedFiles) {
    // Check all ancestor directories for package.json
    const parts = file.relativePath.split('/');
    for (let i = parts.length - 1; i >= 1; i--) {
      const dir = parts.slice(0, i).join('/');
      if (checkedDirs.has(dir)) continue;
      checkedDirs.add(dir);

      const pkgPath = join(projectPath, dir, 'package.json');
      if (!existsSync(pkgPath)) continue;

      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const mainField = pkg.main || pkg.module || '';

        // Check if main/module points to compiled output (out/, dist/, build/)
        if (/^\.?\/?(?:out|dist|build)\//.test(mainField)) {
          // Map to source: out/main -> src/main.ts
          let sourcePath = mainField
            .replace(/^\.?\/?(?:out|dist|build)\//, 'src/')
            .replace(/\.(c|m)?js$/, '');

          // Try to find matching source file with various extensions
          const candidates = [
            // Try exact filename match
            `${dir}/${sourcePath}.ts`,
            `${dir}/${sourcePath}.tsx`,
            `${dir}/${sourcePath}.mts`,
            `${dir}/${sourcePath}.js`,
            `${dir}/${sourcePath}.mjs`,
            // Also try src/index.ts (common pattern for sub-packages)
            `${dir}/src/index.ts`,
            `${dir}/src/index.tsx`,
            `${dir}/src/index.mts`,
            `${dir}/src/index.js`,
            `${dir}/src/index.mjs`,
          ];

          for (const candidate of candidates) {
            if (addedPaths.has(candidate)) continue;
            const found = parsedFiles.find(f => f.relativePath === candidate);
            if (found) {
              entries.push({ file: candidate, reason: `Nested package entry: ${dir}` });
              addedPaths.add(candidate);
              break;
            }
          }
        }
      } catch {}
    }
  }

  return entries;
}

/**
 * Extract entry points from Gemfile/gemspec for Ruby projects
 */
function extractGemEntryPoints(projectPath) {
  const entryPoints = new Set();

  // Check for gemspec
  try {
    const files = readdirSync(projectPath);
    for (const file of files) {
      if (file.endsWith('.gemspec')) {
        const gemspecPath = join(projectPath, file);
        const content = readFileSync(gemspecPath, 'utf-8');
        // Extract lib directory
        const libMatch = content.match(/require_paths?\s*=\s*\[['"]([^'"]+)['"]/);
        if (libMatch) {
          entryPoints.add(libMatch[1] + '/');
        } else {
          // Default lib directory
          if (existsSync(join(projectPath, 'lib'))) {
            entryPoints.add('lib/');
          }
        }
        // Executables
        const binMatch = content.match(/executables\s*=\s*\[([^\]]+)\]/);
        if (binMatch) {
          const bins = binMatch[1].match(/['"]([^'"]+)['"]/g);
          if (bins) {
            for (const bin of bins) {
              entryPoints.add('bin/' + bin.replace(/['"]/g, ''));
            }
          }
        }
      }
    }
  } catch {}

  // Rails conventions
  if (existsSync(join(projectPath, 'config/application.rb'))) {
    entryPoints.add('config/application.rb');
    entryPoints.add('config/routes.rb');
    entryPoints.add('app/controllers/');
    entryPoints.add('app/models/');
    entryPoints.add('app/helpers/');
    entryPoints.add('app/jobs/');
    entryPoints.add('app/mailers/');
  }

  return entryPoints;
}

export default scan;
export { scan as scanProject };
