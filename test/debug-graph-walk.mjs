#!/usr/bin/env node
// Instrument Swynx's graph walk to find WHY each of the 30 files is unreachable
// For each FP file: find what imports it, and whether Swynx's resolveImport resolves correctly

import { extractPathAliases } from '../src/scanner/resolver.mjs';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { execSync } from 'child_process';

const projectPath = '/var/www/n8n';

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

// For each FP, use grep to find ALL importers across entire n8n codebase
console.log('=== CODEBASE-WIDE IMPORT SEARCH ===\n');

for (const fpFile of falsePositives) {
  const fpBase = basename(fpFile).replace(/\.[^.]+$/, '');
  const fpDir = dirname(fpFile);

  // Strategy 1: Search for the basename in import/from statements
  let importers = [];
  try {
    // Search more carefully - look for the basename but exclude self-references
    const grepResult = execSync(
      `grep -rn "from.*['\"].*${fpBase}['\"]\\|import.*['\"].*${fpBase}['\"]" ${join(projectPath, dirname(dirname(fpFile)))} --include="*.ts" --include="*.vue" --include="*.tsx" --include="*.mjs" --include="*.js" 2>/dev/null || true`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    ).trim();

    if (grepResult) {
      for (const line of grepResult.split('\n')) {
        const relPath = line.replace(projectPath + '/', '');
        // Skip self-references
        if (!relPath.startsWith(fpFile + ':')) {
          importers.push(relPath);
        }
      }
    }
  } catch {}

  // Strategy 2: For Vue components, also search the wider editor-ui
  if (fpFile.endsWith('.vue') && importers.length === 0) {
    try {
      const grepResult = execSync(
        `grep -rn "${fpBase}" ${join(projectPath, 'packages/frontend/editor-ui/src')} --include="*.ts" --include="*.vue" --include="*.tsx" -l 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      ).trim();

      if (grepResult) {
        for (const file of grepResult.split('\n')) {
          if (file && !file.includes(fpFile)) {
            importers.push(file.replace(projectPath + '/', '') + ' (name match)');
          }
        }
      }
    } catch {}
  }

  // Strategy 3: For CLI files, search the CLI package
  if (fpFile.startsWith('packages/cli/') && importers.length === 0) {
    try {
      const grepResult = execSync(
        `grep -rn "${fpBase}" ${join(projectPath, 'packages/cli/src')} --include="*.ts" -l 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      ).trim();

      if (grepResult) {
        for (const file of grepResult.split('\n')) {
          if (file && !file.includes(fpFile)) {
            importers.push(file.replace(projectPath + '/', '') + ' (name match)');
          }
        }
      }
    } catch {}
  }

  // Categorize the file
  let category;
  if (importers.length === 0) {
    category = 'TRULY DEAD (no imports found anywhere)';
  } else if (importers.some(i => i.includes('import') || i.includes('from'))) {
    category = 'IMPORTED - chain break in Swynx';
  } else {
    category = 'NAME REFERENCED (may not be direct import)';
  }

  console.log(`${fpFile}:`);
  console.log(`  Category: ${category}`);
  if (importers.length > 0) {
    for (const imp of importers.slice(0, 5)) {
      console.log(`  <- ${imp}`);
    }
    if (importers.length > 5) console.log(`  ... and ${importers.length - 5} more`);
  }
  console.log();
}
