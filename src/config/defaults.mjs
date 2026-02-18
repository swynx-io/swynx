// src/config/defaults.mjs
// Default configuration values for Swynx

/**
 * Default cost calculation settings
 * All costs are transparent and show their sources
 */
export const DEFAULT_COSTS = {
  // Developer time costs
  developerHourlyRate: 75,
  teamSize: 5,
  newHiresPerYear: 2,
  onboardingHoursWasted: 8,
  maintenanceOverheadPercent: 10,

  // Currency settings
  currency: 'GBP',
  currencySymbol: '£'
};

/**
 * Default emissions settings
 * Aligned with EcoPigs Carbon Methodology
 */
export const DEFAULT_EMISSIONS = {
  monthlyVisitors: 10000,
  avgPagesPerVisit: 3,
  cacheRate: 0.7,
  region: 'Global',
  greenHosted: false
};

/**
 * Default threshold settings for quality gates
 */
export const DEFAULT_THRESHOLDS = {
  wastePercent: 10,
  maxCriticalVulnerabilities: 0,
  maxHighVulnerabilities: 0,
  maxUnusedDeps: 5,
  maxDeadCodePercent: 5,
  maxBundleSizeBytes: 1.5 * 1024 * 1024, // 1.5 MB
  failOnRestrictiveLicense: true,
  failOnUnknownLicense: true
};

/**
 * Default dead code detection settings
 */
export const DEFAULT_DEAD_CODE = {
  // Glob patterns for dynamically loaded files (treated as entry points)
  // Files matching these patterns won't be flagged as dead code
  // e.g., ["**/*.node.ts", "**/migrations/*.ts", "**/*.controller.ts"]
  dynamicPatterns: [],

  // Decorator names that mark classes as entry points (DI-injected)
  // Default covers common frameworks - users can add their own
  diDecorators: [
    'Service', 'Injectable', 'Controller', 'Module', 'Component',
    'Entity', 'Repository', 'Resolver', 'Guard', 'Pipe',
    'EventSubscriber', 'Subscriber', 'Singleton'
  ],

  // Patterns for DI container access (regex strings)
  // Files containing these patterns have their referenced classes marked as live
  diContainerPatterns: [
    'Container\\.get\\s*[<(]',
    'Container\\.resolve\\s*[<(]',
    'container\\.resolve\\s*[<(]',
    'moduleRef\\.get\\s*[<(]',
    'injector\\.get\\s*[<(]'
  ],

  // Package.json fields that contain dynamically loaded file paths
  // These are searched recursively in package.json objects
  dynamicPackageFields: ['nodes', 'plugins', 'credentials', 'extensions', 'adapters', 'connectors']
};

/**
 * Default rule configuration
 */
export const DEFAULT_RULES = {
  // Enable all rules by default
  enabled: true
};

/**
 * Default CI/CD integration settings
 * All integrations are OFF by default
 */
export const DEFAULT_CI = {
  slack: {
    enabled: false,
    webhook: null,
    notify: 'on-failure'  // always | on-failure | on-regression
  },
  github: {
    enabled: false,
    annotations: { enabled: false, maxAnnotations: 50 },
    summary: { enabled: false }
  },
  gitlab: {
    enabled: false,
    codequality: { enabled: false, outputPath: 'gl-code-quality-report.json' }
  },
  jenkins: {
    enabled: false,
    console: { enabled: false, format: 'structured' }
  }
};

/**
 * Enterprise configuration for large-scale codebases
 * Supports monorepos, multiple languages, and enterprise frameworks
 */
export const DEFAULT_ENTERPRISE = {
  // Build system detection
  buildSystems: {
    // JavaScript/TypeScript (already handled in core)
    npm: { enabled: true, configFiles: ['package.json'] },
    pnpm: { enabled: true, configFiles: ['pnpm-workspace.yaml'] },
    yarn: { enabled: true, configFiles: ['package.json'] },  // uses workspaces field
    lerna: { enabled: true, configFiles: ['lerna.json'] },
    nx: { enabled: true, configFiles: ['nx.json', 'workspace.json'] },
    turborepo: { enabled: true, configFiles: ['turbo.json'] },
    rush: { enabled: true, configFiles: ['rush.json'] },

    // Java/JVM
    gradle: { enabled: true, configFiles: ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts'] },
    maven: { enabled: true, configFiles: ['pom.xml'] },

    // .NET
    dotnet: { enabled: true, configFiles: ['*.sln', '*.csproj', 'Directory.Build.props'] },

    // Go
    go: { enabled: true, configFiles: ['go.work', 'go.mod'] },

    // Rust
    cargo: { enabled: true, configFiles: ['Cargo.toml'] },

    // Python
    python: { enabled: true, configFiles: ['pyproject.toml', 'setup.py', 'setup.cfg'] },

    // Build tools (language-agnostic)
    bazel: { enabled: true, configFiles: ['WORKSPACE', 'WORKSPACE.bazel', 'MODULE.bazel'] },
    buck: { enabled: true, configFiles: ['.buckconfig', 'BUCK', 'BUCK.v2'] },
    pants: { enabled: true, configFiles: ['pants.toml'] }
  },

  // Language-specific framework detection
  frameworks: {
    // Java/JVM frameworks
    java: {
      enabled: true,
      // Spring Framework annotations
      springAnnotations: [
        'Component', 'Service', 'Repository', 'Controller', 'RestController',
        'Configuration', 'Bean', 'Autowired', 'Inject', 'Value',
        'RequestMapping', 'GetMapping', 'PostMapping', 'PutMapping', 'DeleteMapping', 'PatchMapping',
        'Entity', 'Table', 'MappedSuperclass', 'Embeddable', 'Id', 'Column',
        'Aspect', 'Around', 'Before', 'After', 'AfterReturning', 'AfterThrowing', 'Pointcut',
        'SpringBootApplication', 'EnableAutoConfiguration', 'ComponentScan',
        'Transactional', 'Async', 'Scheduled', 'EventListener',
        'Valid', 'Validated', 'PathVariable', 'RequestParam', 'RequestBody'
      ],
      // Google Guice
      guiceAnnotations: ['Inject', 'Provides', 'Singleton', 'Module', 'ImplementedBy', 'ProvidedBy'],
      // Dagger
      daggerAnnotations: ['Inject', 'Provides', 'Component', 'Module', 'Singleton', 'Binds', 'IntoSet', 'IntoMap'],
      // Micronaut
      micronautAnnotations: ['Singleton', 'Prototype', 'Controller', 'Client', 'Bean', 'Factory', 'Inject'],
      // Quarkus
      quarkusAnnotations: ['ApplicationScoped', 'RequestScoped', 'SessionScoped', 'Inject', 'ConfigProperty'],
      // Jakarta/Java EE
      jakartaAnnotations: ['Named', 'ManagedBean', 'Stateless', 'Stateful', 'MessageDriven', 'Entity', 'WebServlet']
    },

    // .NET/C# frameworks
    dotnet: {
      enabled: true,
      // ASP.NET Core
      aspnetAnnotations: [
        'ApiController', 'Controller', 'HttpGet', 'HttpPost', 'HttpPut', 'HttpDelete', 'HttpPatch',
        'Route', 'Authorize', 'AllowAnonymous', 'FromBody', 'FromQuery', 'FromRoute',
        'Produces', 'Consumes', 'ProducesResponseType'
      ],
      // Entity Framework
      efAnnotations: ['Entity', 'Table', 'Key', 'Column', 'ForeignKey', 'DbContext', 'DbSet', 'NotMapped'],
      // DI annotations
      diAnnotations: ['Service', 'Scoped', 'Singleton', 'Transient', 'Inject'],
      // Blazor
      blazorAnnotations: ['Parameter', 'CascadingParameter', 'Inject', 'Route']
    },

    // Python frameworks
    python: {
      enabled: true,
      // Django
      djangoPatterns: ['Model', 'View', 'ViewSet', 'Serializer', 'Admin', 'Form', 'ModelForm', 'APIView'],
      // FastAPI
      fastapiPatterns: ['APIRouter', 'Depends', 'FastAPI', 'Query', 'Path', 'Body', 'Header'],
      // Flask
      flaskPatterns: ['Blueprint', 'Flask', 'route', 'before_request', 'after_request'],
      // Celery
      celeryPatterns: ['task', 'shared_task', 'periodic_task'],
      // SQLAlchemy
      sqlalchemyPatterns: ['Column', 'relationship', 'Base', 'Session']
    },

    // Go frameworks
    go: {
      enabled: true,
      entryPatterns: ['func main()', 'func init()'],
      // DI frameworks
      wirePatterns: ['wire.Build', 'wire.NewSet', 'wire.Struct', 'wire.Bind'],
      fxPatterns: ['fx.New', 'fx.Provide', 'fx.Invoke', 'fx.Module', 'fx.Options'],
      digPatterns: ['dig.New', 'container.Provide', 'container.Invoke']
    },

    // Rust patterns
    rust: {
      enabled: true,
      entryPatterns: ['fn main()', '#[tokio::main]', '#[actix_web::main]', '#[rocket::main]'],
      macroPatterns: ['#[derive(', '#[proc_macro]', '#[test]', '#[cfg(test)]', '#[bench]'],
      // Actix/Axum/Rocket web frameworks
      webPatterns: ['#[get(', '#[post(', '#[put(', '#[delete(', '#[route(']
    },

    // Kotlin (Android/JVM)
    kotlin: {
      enabled: true,
      // Kotlin-specific + shared Java annotations
      annotations: [
        'Component', 'Service', 'Repository', 'Controller', 'RestController',
        'Inject', 'Singleton', 'Module', 'Provides',
        // Android
        'Activity', 'Fragment', 'ViewModel', 'Composable', 'HiltViewModel'
      ]
    }
  },

  // Generated code patterns (excluded from dead code analysis)
  generatedCode: {
    // File patterns for generated code
    excludePatterns: [
      // JavaScript/TypeScript
      '**/*.generated.ts', '**/*.generated.js', '**/*.generated.tsx', '**/*.generated.jsx',
      '**/generated/**', '**/__generated__/**', '**/codegen/**',
      '**/*.g.ts', '**/*.g.js',

      // GraphQL
      '**/graphql.ts', '**/gql.ts', '**/*.graphql.ts', '**/types.generated.ts',
      '**/graphql/**/*.ts', '**/__graphql__/**',

      // Protocol Buffers
      '**/*_pb.js', '**/*_pb.d.ts', '**/*_pb2.py', '**/*_pb2.pyi',
      '**/*.pb.go', '**/*.pb.cc', '**/*.pb.h',

      // OpenAPI/Swagger
      '**/api-client/**', '**/swagger-client/**', '**/openapi/**/*.generated.*',

      // Java
      '**/target/generated-sources/**', '**/target/generated-test-sources/**',
      '**/build/generated/**', '**/build/generated-sources/**',
      '**/*_.java',  // MapStruct, etc.

      // .NET
      '**/obj/**', '**/*.Designer.cs', '**/*.g.cs', '**/*.g.i.cs',
      '**/Migrations/*.cs',

      // Go
      '**/*_gen.go', '**/mock_*.go', '**/*_mock.go', '**/*.pb.go',
      '**/mocks/**/*.go', '**/*_string.go',  // stringer

      // Rust
      '**/*.rs.bk',

      // Python
      '**/*_pb2.py', '**/*_pb2_grpc.py',

      // Generic
      '**/dist/**', '**/build/**', '**/out/**', '**/output/**',
      '**/.next/**', '**/.nuxt/**', '**/.output/**'
    ],

    // Codegen config files (source files for these should be tracked)
    codegenConfigs: {
      graphql: ['codegen.yml', 'codegen.yaml', 'codegen.ts', 'codegen.js', '.graphqlrc.yml'],
      protobuf: ['buf.yaml', 'buf.gen.yaml', 'buf.work.yaml'],
      openapi: ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.yaml', 'swagger.json'],
      thrift: [],  // *.thrift files detected by extension
      grpc: ['grpc-tools.config.js']
    }
  },

  // Test framework patterns (test files are entry points)
  testPatterns: {
    // JavaScript/TypeScript
    jest: ['**/*.test.{js,ts,jsx,tsx,mjs}', '**/*.spec.{js,ts,jsx,tsx,mjs}', '**/__tests__/**/*.{js,ts,jsx,tsx,mjs}'],
    mocha: ['test/**/*.{js,ts,mjs}', 'spec/**/*.{js,ts,mjs}', '**/*.test.{js,ts,mjs}'],
    vitest: ['**/*.test.{js,ts,jsx,tsx}', '**/*.spec.{js,ts,jsx,tsx}'],
    playwright: ['**/*.spec.{js,ts}', '**/e2e/**/*.{js,ts}'],
    cypress: ['cypress/**/*.{js,ts,jsx,tsx}', '**/*.cy.{js,ts,jsx,tsx}'],

    // Python
    pytest: ['test_*.py', '*_test.py', 'tests/**/*.py', '**/test_*.py', '**/*_test.py'],
    unittest: ['test_*.py', '*_test.py'],

    // Java
    junit: ['**/*Test.java', '**/*Tests.java', '**/Test*.java', '**/*IT.java', '**/*IntegrationTest.java'],
    testng: ['**/*Test.java', '**/*Tests.java'],

    // .NET
    xunit: ['**/*Tests.cs', '**/*Test.cs', '**/*.Tests/**/*.cs'],
    nunit: ['**/*Tests.cs', '**/*Test.cs'],
    mstest: ['**/*Tests.cs', '**/*Test.cs'],

    // Go
    gotest: ['**/*_test.go'],

    // Rust
    rusttest: ['**/tests/**/*.rs']  // Also #[test] attribute detected in parser
  },

  // Bundler/build tool configs (entry points defined here)
  bundlerConfigs: [
    // Webpack
    'webpack.config.js', 'webpack.config.ts', 'webpack.config.mjs',
    'webpack.*.js', 'webpack.*.ts',

    // Vite
    'vite.config.js', 'vite.config.ts', 'vite.config.mjs',

    // Rollup
    'rollup.config.js', 'rollup.config.ts', 'rollup.config.mjs',

    // esbuild
    'esbuild.config.js', 'esbuild.config.mjs', 'esbuild.mjs',

    // Parcel
    '.parcelrc', 'parcel.config.js',

    // Snowpack
    'snowpack.config.js', 'snowpack.config.mjs',

    // WMR
    'wmr.config.js'
  ],

  // CI/CD configs (scripts referenced here are entry points)
  ciConfigs: {
    github: ['.github/workflows/*.yml', '.github/workflows/*.yaml', '.github/actions/**/*.yml'],
    gitlab: ['.gitlab-ci.yml', '.gitlab-ci/*.yml'],
    jenkins: ['Jenkinsfile', 'Jenkinsfile.*', 'jenkins/**/*.groovy'],
    azure: ['azure-pipelines.yml', 'azure-pipelines/*.yml', '.azure-pipelines/**/*.yml'],
    circleci: ['.circleci/config.yml', '.circleci/**/*.yml'],
    travis: ['.travis.yml'],
    bitbucket: ['bitbucket-pipelines.yml'],
    drone: ['.drone.yml'],
    tekton: ['tekton/**/*.yaml', '.tekton/**/*.yaml'],
    argo: ['argo/**/*.yaml', '.argo/**/*.yaml']
  },

  // Container configs (entry points defined here)
  containerConfigs: {
    docker: ['Dockerfile', 'Dockerfile.*', 'docker-compose.yml', 'docker-compose.*.yml', 'compose.yml', 'compose.*.yml'],
    kubernetes: ['k8s/**/*.yaml', 'kubernetes/**/*.yaml', 'deploy/**/*.yaml', 'manifests/**/*.yaml', 'helm/**/*.yaml'],
    podman: ['Containerfile', 'Containerfile.*']
  },

  // Soft references (config files that may contain file path strings)
  softReferences: {
    configFiles: [
      // JavaScript/TypeScript
      'jest.config.{js,ts,mjs,cjs,json}', 'jest.config.*.{js,ts}',
      '.eslintrc.{js,json,yml,yaml}', 'eslint.config.{js,mjs}',
      '.prettierrc.{js,json,yml,yaml}', 'prettier.config.{js,mjs}',
      'tsconfig.json', 'tsconfig.*.json', 'jsconfig.json',
      '.babelrc', 'babel.config.{js,json,mjs}',
      'tailwind.config.{js,ts}', 'postcss.config.{js,mjs}',
      'next.config.{js,mjs}', 'nuxt.config.{js,ts}',
      'svelte.config.js', 'astro.config.mjs',

      // Python
      'pyproject.toml', 'setup.cfg', 'setup.py', 'tox.ini', 'pytest.ini',
      'mypy.ini', '.flake8', '.pylintrc',

      // Go
      'go.mod', 'go.sum',

      // Rust
      'Cargo.toml', 'Cargo.lock',

      // Java
      'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',

      // .NET
      '*.csproj', '*.fsproj', '*.vbproj', 'appsettings.json', 'appsettings.*.json'
    ],

    // Dynamic import patterns (template literals are hard to analyze)
    dynamicImportWarning: true  // Warn when detecting dynamic imports with variables
  },

  // Performance settings for large codebases
  performance: {
    maxFileSizeBytes: 2_000_000,  // Skip files larger than 2MB
    maxFilesPerBatch: 1000,       // Process files in batches
    parallelParsers: true,        // Use worker threads where available
    cacheEnabled: true,           // Cache parsed results
    incrementalEnabled: false,    // Future: only analyze changed files
    timeoutPerFileMs: 5000        // Timeout for parsing individual files
  }
};

/**
 * Complete default configuration
 */
export const DEFAULT_CONFIG = {
  costs: DEFAULT_COSTS,
  emissions: DEFAULT_EMISSIONS,
  thresholds: DEFAULT_THRESHOLDS,
  rules: DEFAULT_RULES,
  ci: DEFAULT_CI,
  deadCode: DEFAULT_DEAD_CODE,
  enterprise: DEFAULT_ENTERPRISE
};

/**
 * Currency symbols lookup
 */
export const CURRENCY_SYMBOLS = {
  GBP: '£',
  USD: '$',
  EUR: '€',
  AUD: 'A$',
  CAD: 'C$',
  JPY: '¥',
  CHF: 'CHF'
};

/**
 * Get currency symbol for a currency code
 */
export function getCurrencySymbol(currency) {
  return CURRENCY_SYMBOLS[currency] || currency;
}

export default DEFAULT_CONFIG;
