#!/usr/bin/env node
// Trace import resolution for the 30 false positive files in n8n
// Goal: Find who imports each FP file and whether Swynx resolves the import

import { extractPathAliases } from '../src/scanner/resolver.mjs';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
// import { parseJavaScript } from '../src/scanner/parsers/javascript.mjs';

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

// Group by category
const categories = {
  'Workspace entry point': falsePositives.filter(f =>
    f.includes('codemirror-lang-html') || f.includes('codemirror-lang/') ||
    f.includes('scan-community') || f.includes('benchmark')),
  'Design system': falsePositives.filter(f => f.includes('design-system')),
  'Rest API client': falsePositives.filter(f => f.includes('rest-api-client')),
  'Editor-UI Vue': falsePositives.filter(f => f.includes('editor-ui') && f.endsWith('.vue')),
  'Editor-UI TS': falsePositives.filter(f => f.includes('editor-ui') && !f.endsWith('.vue')),
  'CLI': falsePositives.filter(f => f.includes('packages/cli/')),
};

// For each false positive, search for actual imports in the source
async function findRealImporters(fpFile) {
  const fpBase = basename(fpFile).replace(/\.[^.]+$/, '');
  const fpDir = dirname(fpFile);
  const results = [];

  // Search strategy: look in nearby index files, parent directories, and known importers
  const searchDirs = [
    fpDir,                    // Same directory (barrel exports)
    dirname(fpDir),           // Parent directory
    dirname(dirname(fpDir)),  // Grandparent
  ];

  for (const dir of searchDirs) {
    const absDir = join(projectPath, dir);
    if (!existsSync(absDir)) continue;

    try {
      const entries = await import('fs').then(fs => fs.readdirSync(absDir));
      for (const entry of entries) {
        if (!entry.match(/\.(ts|tsx|mts|js|mjs|vue)$/)) continue;
        const entryPath = join(absDir, entry);
        const relPath = entryPath.replace(projectPath + '/', '');
        if (relPath === fpFile) continue;

        try {
          const content = readFileSync(entryPath, 'utf-8');
          // Check for imports of the FP file's basename
          if (content.includes(fpBase) ||
              content.includes(`./${basename(fpFile)}`) ||
              content.includes(`./${fpBase}`)) {
            // Extract the actual import line
            const lines = content.split('\n');
            for (const line of lines) {
              if ((line.includes('import') || line.includes('require') || line.includes('export')) &&
                  (line.includes(fpBase) || line.includes(basename(fpFile)))) {
                results.push({ from: relPath, line: line.trim() });
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  return results;
}

// Test workspace entry point resolution
const { workspacePackages } = extractPathAliases(projectPath);

console.log('=== WORKSPACE ENTRY POINT ISSUES ===\n');

for (const [name, info] of workspacePackages) {
  if (!name.includes('codemirror') && !name.includes('scan-community') && !name.includes('benchmark') &&
      !name.includes('design-system') && !name.includes('rest-api')) continue;

  const entryPath = join(info.dir, info.entryPoint);
  const withTs = entryPath + '.ts';
  const withMts = entryPath + '.mts';
  const withJs = entryPath + '.js';
  const withMjs = entryPath + '.mjs';
  const withTsx = entryPath + '.tsx';

  const exists = [withTs, withMts, withJs, withMjs, withTsx, entryPath].some(p =>
    existsSync(join(projectPath, p))
  );

  console.log(`${name}:`);
  console.log(`  dir: ${info.dir}`);
  console.log(`  entry: ${info.entryPoint}`);
  console.log(`  resolved path: ${entryPath}`);
  console.log(`  file exists: ${exists}`);

  if (!exists) {
    // Try to find what files ARE in the src directory
    const srcDir = join(projectPath, info.dir, 'src');
    if (existsSync(srcDir)) {
      const files = await import('fs').then(fs => fs.readdirSync(srcDir));
      console.log(`  actual src/ files: ${files.join(', ')}`);
    }

    // Check if there's a source field in package.json
    const pkgPath = join(projectPath, info.dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.source) console.log(`  package.json source: ${pkg.source}`);
      if (pkg.scripts?.build) console.log(`  build script: ${pkg.scripts.build}`);
    }
  }
  console.log();
}

console.log('\n=== IMPORT CHAIN TRACING ===\n');

// For each FP, find who imports it
for (const fpFile of falsePositives) {
  const importers = await findRealImporters(fpFile);
  console.log(`${fpFile}:`);
  if (importers.length > 0) {
    for (const imp of importers.slice(0, 3)) {
      console.log(`  <- ${imp.from}`);
      console.log(`     ${imp.line}`);
    }
  } else {
    console.log('  No nearby importers found');
  }
  console.log();
}

// Special deep trace for specific patterns
console.log('\n=== DEEP TRACE: Vue Router Lazy Imports ===\n');

// Check if editor-ui has a router file that lazy-imports Vue components
const routerPatterns = ['router', 'routes'];
const editorUiSrc = join(projectPath, 'packages/frontend/editor-ui/src');

function findFilesRecursive(dir, pattern, results = []) {
  try {
    for (const entry of import('fs').then ? require('fs').readdirSync(dir, { withFileTypes: true }) : []) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        findFilesRecursive(join(dir, entry.name), pattern, results);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(join(dir, entry.name));
      }
    }
  } catch {}
  return results;
}

// Search for lazy/dynamic imports of the Vue FP components
const vueFPs = falsePositives.filter(f => f.endsWith('.vue'));
for (const vfp of vueFPs) {
  const componentName = basename(vfp, '.vue');
  console.log(`Searching for dynamic imports of ${componentName}...`);

  // Search using grep-like approach in editor-ui
  const searchPaths = [
    join(projectPath, 'packages/frontend/editor-ui/src'),
  ];

  for (const searchPath of searchPaths) {
    try {
      const { execSync } = await import('child_process');
      const result = execSync(
        `grep -r "${componentName}" "${searchPath}" --include="*.ts" --include="*.vue" --include="*.tsx" -l 2>/dev/null`,
        { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
      ).trim();
      if (result) {
        for (const file of result.split('\n')) {
          const relFile = file.replace(projectPath + '/', '');
          // Get the matching lines
          const content = readFileSync(file, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(componentName)) {
              console.log(`  Found in ${relFile}:${i + 1}: ${lines[i].trim()}`);
            }
          }
        }
      }
    } catch {}
  }
  console.log();
}

// Check CLI error files
console.log('\n=== DEEP TRACE: CLI Error Imports ===\n');
const cliFPs = falsePositives.filter(f => f.startsWith('packages/cli/'));
for (const cfp of cliFPs) {
  const fileName = basename(cfp, '.ts');
  console.log(`Searching for imports of ${fileName}...`);
  try {
    const { execSync } = await import('child_process');
    const result = execSync(
      `grep -r "${fileName}" "${join(projectPath, 'packages/cli/src')}" --include="*.ts" -l 2>/dev/null`,
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    ).trim();
    if (result) {
      for (const file of result.split('\n')) {
        const relFile = file.replace(projectPath + '/', '');
        const content = readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(fileName) && (lines[i].includes('import') || lines[i].includes('from'))) {
            console.log(`  ${relFile}:${i + 1}: ${lines[i].trim()}`);
          }
        }
      }
    }
  } catch {}
  console.log();
}

// Check design system mixins
console.log('\n=== DEEP TRACE: Design System Mixins ===\n');
try {
  const { execSync } = await import('child_process');
  const result = execSync(
    `grep -r "mixins" "${join(projectPath, 'packages/frontend/@n8n/design-system/src')}" --include="*.ts" --include="*.vue" -l 2>/dev/null`,
    { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
  ).trim();
  if (result) {
    for (const file of result.split('\n')) {
      const relFile = file.replace(projectPath + '/', '');
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('mixins') && (lines[i].includes('import') || lines[i].includes('from') || lines[i].includes('export'))) {
          console.log(`  ${relFile}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }
  }
} catch {}

// Check rest-api-client execution
console.log('\n\n=== DEEP TRACE: Rest API Client ===\n');
try {
  const { execSync } = await import('child_process');
  const result = execSync(
    `grep -r "execution" "${join(projectPath, 'packages/frontend/@n8n/rest-api-client/src')}" --include="*.ts" -l 2>/dev/null`,
    { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
  ).trim();
  if (result) {
    for (const file of result.split('\n')) {
      const relFile = file.replace(projectPath + '/', '');
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('execution') && (lines[i].includes('import') || lines[i].includes('from') || lines[i].includes('export'))) {
          console.log(`  ${relFile}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }
  }
} catch {}
