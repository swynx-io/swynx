#!/usr/bin/env node
// Check which PEER Audit entry point patterns match the 30 FP files

const PEER_PATTERNS = [
  [/\/commands\//, 'CLI commands'],
  [/\/bin\//, 'bin'],
  [/\/scripts?\//, 'scripts'],
  [/\.(test|spec)(\.\w+)*\.([mc]?[jt]s|[jt]sx)$/, 'test file'],
  [/__tests__\/[^/]+\.([mc]?[jt]s|[jt]sx)$/, 'jest test dir'],
  [/workers?\//i, 'worker directory'],
  [/\.worker\.([mc]?[jt]s|[jt]sx)$/, 'worker file'],
  [/-worker\.([mc]?[jt]s|[jt]sx)$/, 'worker suffix'],
  [/\/templates?\//, 'template'],
  [/\.stories\.([mc]?[jt]s|[jt]sx)$/, 'storybook'],
  [/\.(config|rc)(\.\w+)*\.([mc]?[jt]s|json)$/, 'config file'],
  [/\.d\.ts$/, '.d.ts declaration'],
  [/\/e2e\//, 'e2e test'],
  [/\/fixtures\//, 'fixtures'],
  [/\/testing\//, 'testing dir'],
  [/-testing\//, 'testing package'],
  [/^packages\/[^/]+\/src\/(index|main|server|app|init)\.([mc]?[jt]s|[jt]sx)$/, 'pkg entry'],
  [/^packages\/[^/]+\/[^/]+\/src\/(index|main|server|app|init)\.([mc]?[jt]s|[jt]sx)$/, 'nested pkg entry'],
  // Frameworks
  [/\.controller\.([mc]?[jt]s|tsx)$/, 'NestJS controller'],
  [/\.handler\.([mc]?[jt]s|tsx)$/, 'NestJS handler'],
  [/router\.([mc]?[jt]s|tsx)$/, 'Vue router'],
  [/\.store\.([mc]?[jt]s|tsx)$/, 'Pinia store'],
  // Additional
  [/\/pages\//, 'pages (routing)'],
  [/^src\/app\//, 'app router'],
  [/\/containers\//, 'DI containers'],
  [/\/providers\//, 'providers'],
  [/\/modules\//, 'modules'],
  [/^[^/]+\/app\/.*\.(tsx?|jsx?)$/, 'sub-project app'],
  [/\/handlers\//, 'handlers dir'],
  [/\/errors\//, 'errors dir'],
  [/\/views\//, 'views dir'],
  [/\/components\//, 'components dir'],
  [/\/mixins\//, 'mixins dir'],
  [/\/experiments\//, 'experiments dir'],
  [/\/features\//, 'features dir'],
  [/\/api\//, 'api dir'],
];

const falsePositives = [
  "packages/@n8n/codemirror-lang-html/src/complete.ts",
  "packages/@n8n/codemirror-lang-html/src/html.ts",
  "packages/@n8n/scan-community-package/scanner/scanner.mjs",
  "packages/@n8n/benchmark/src/test-execution/k6-summary.ts",
  "packages/frontend/editor-ui/src/features/shared/nodeCreator/components/Panel/CommunityNodeDetails.vue",
  "packages/frontend/editor-ui/src/experiments/readyToRunWorkflowsV2/workflows/ai-workflow-v4.ts",
  "packages/frontend/editor-ui/src/experiments/readyToRunWorkflowsV2/workflows/ai-workflow-v3.ts",
  "packages/frontend/editor-ui/src/experiments/resourceCenter/components/FeaturedSandboxCard.vue",
  "packages/cli/src/eventbus/message-event-bus-writer/message-event-bus-log-writer-worker.ts",
  "packages/frontend/editor-ui/src/experiments/personalizedTemplatesV3/components/TemplateTooltip.vue",
  "packages/cli/src/public-api/v1/handlers/users/users.handler.ee.ts",
  "packages/cli/src/config/types.ts",
  "packages/frontend/editor-ui/src/features/ai/evaluation.ee/components/shared/TableStatusCell.vue",
  "packages/frontend/editor-ui/src/app/components/MainSidebarUserArea.vue",
  "packages/frontend/editor-ui/src/features/settings/environments.ee/components/VariablesForm.vue",
  "packages/frontend/editor-ui/src/experiments/resourceCenter/components/CourseCard.vue",
  "packages/frontend/editor-ui/src/app/views/CanvasAddButton.vue",
  "packages/cli/src/public-api/v1/handlers/users/users.service.ee.ts",
  "packages/frontend/editor-ui/src/experiments/resourceCenter/components/QuickStartCard.vue",
  "packages/frontend/editor-ui/src/features/ai/evaluation.ee/components/shared/TableCell.vue",
  "packages/@n8n/scan-community-package/scanner/cli.mjs",
  "packages/frontend/editor-ui/src/app/components/ShortenName.vue",
  "packages/cli/src/errors/redactable.error.ts",
  "packages/cli/src/errors/postgres-live-rows-retrieval.error.ts",
  "packages/frontend/@n8n/design-system/src/mixins/locale.ts",
  "packages/@n8n/codemirror-lang/src/expressions/grammar.terms.ts",
  "packages/cli/src/errors/invalid-role.error.ts",
  "packages/frontend/@n8n/design-system/src/mixins/index.ts",
  "packages/frontend/editor-ui/vite/source-map-js-shim.ts",
  "packages/frontend/@n8n/rest-api-client/src/api/execution.ts"
];

// Also check Swynx's ENTRY_POINT_PATTERNS
import { readFileSync } from 'fs';
const indexSrc = readFileSync('/var/www/swynx/src/scanner/index.mjs', 'utf-8');

console.log('=== PEER AUDIT PATTERN MATCHING FOR 30 FP FILES ===\n');

for (const fp of falsePositives) {
  const matches = PEER_PATTERNS.filter(([re]) => re.test(fp));
  if (matches.length > 0) {
    console.log(`${fp}:`);
    for (const [, name] of matches) {
      console.log(`  MATCH: ${name}`);
    }
  } else {
    console.log(`${fp}: NO MATCH`);
  }
}

// Now check which patterns in PEER Audit's ENTRY_POINT_PATTERNS array would match
// that Swynx doesn't have
console.log('\n\n=== CRITICAL PATTERNS MISSING FROM SWYNX ===\n');

// The key PEER Audit patterns that Swynx might be missing
const criticalPatterns = [
  [/workers?\//i, 'worker directory - matches message-event-bus-writer/'],
  [/-worker\.([mc]?[jt]s|[jt]sx)$/, 'worker suffix - matches *-worker.ts'],
  [/\/handlers\//, 'handlers/ directory'],
];

// Check which FP files match these critical patterns
for (const [re, desc] of criticalPatterns) {
  const matching = falsePositives.filter(fp => re.test(fp));
  if (matching.length > 0) {
    console.log(`Pattern: ${desc}`);
    for (const m of matching) {
      console.log(`  ${m}`);
    }
  }
}
