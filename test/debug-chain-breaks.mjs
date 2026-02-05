#!/usr/bin/env node
// Debug script: Find where import chains break for the 30 false positive files in n8n

import { scan } from '../src/scanner/index.mjs';
import { extractPathAliases } from '../src/scanner/resolver.mjs';
import { dirname, join, basename } from 'path';
import { readFileSync } from 'fs';

const projectPath = '/var/www/n8n';

// The 30 files Swynx marks dead but PEER Audit marks alive
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

console.log('=== CHAIN BREAK DIAGNOSTIC ===\n');

// Step 1: Find who imports each false positive file
console.log('--- Step 1: Reverse import lookup ---\n');

// We need to find actual imports in the source code that should lead to these files
// Strategy: grep-style search through parsed files

const result = await scan(projectPath);
const { parsedFiles, entryPointFiles } = result._debug || {};

if (!parsedFiles) {
  console.log('ERROR: scan() did not return _debug info. Need to add it.');

  // Alternative: manually trace by reading source files
  console.log('\nFalling back to manual import tracing...\n');

  // Get resolver info
  const { aliases, packageAliases, workspacePackages, packageBaseUrls } = extractPathAliases(projectPath);

  console.log('Workspace packages related to FPs:');
  for (const [name, info] of workspacePackages) {
    if (name.includes('codemirror') || name.includes('design-system') || name.includes('rest-api') || name.includes('scan-community') || name.includes('benchmark')) {
      console.log(`  ${name}: dir=${info.dir}, entry=${info.entryPoint}, exports=[${[...info.exportsMap.keys()].join(', ')}]`);
    }
  }

  console.log('\nPath aliases for editor-ui:');
  for (const [pkgDir, pkgAliases] of packageAliases) {
    if (pkgDir.includes('editor-ui')) {
      for (const [alias, target] of pkgAliases) {
        console.log(`  ${alias} -> ${target}`);
      }
    }
  }

  console.log('\nGlobal aliases:');
  for (const [alias, target] of aliases) {
    console.log(`  ${alias} -> ${target}`);
  }

  process.exit(0);
}

// Build reverse import map: file -> who imports it
const reverseImports = new Map();

for (const file of parsedFiles) {
  const fp = file.relativePath;
  for (const imp of file.imports || []) {
    const mod = imp.module || imp;
    if (typeof mod !== 'string') continue;

    // Check if this import SHOULD resolve to any false positive
    for (const fpFile of falsePositives) {
      const fpNoExt = fpFile.replace(/\.([mc]?[jt]s|[jt]sx|vue)$/, '');
      const fpBase = basename(fpFile).replace(/\.([mc]?[jt]s|[jt]sx|vue)$/, '');

      // Simple heuristic: does the import path contain the filename or directory?
      if (mod.includes(fpBase) || mod.endsWith(fpBase)) {
        if (!reverseImports.has(fpFile)) reverseImports.set(fpFile, []);
        reverseImports.get(fpFile).push({ from: fp, import: mod });
      }
    }
  }
}

for (const fpFile of falsePositives) {
  const importers = reverseImports.get(fpFile) || [];
  console.log(`\n${fpFile}:`);
  if (importers.length === 0) {
    console.log('  No direct import matches found (may be via barrel/re-export)');
  } else {
    for (const imp of importers) {
      console.log(`  imported by: ${imp.from} via "${imp.import}"`);
    }
  }
}
