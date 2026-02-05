// src/cli/commands/fix.mjs
// Fix command implementation

import { scanProject } from '../../scanner/index.mjs';
import { getRecentScans } from '../../storage/index.mjs';
import {
  listModules,
  analyseAll,
  previewModule,
  applyFix,
  autoFix
} from '../../fixer/index.mjs';

export async function fixCommand(projectPath, options) {
  // List modules
  if (options.list) {
    console.log('\n Available Fix Modules\n');
    const modules = listModules();
    for (const mod of modules) {
      const confidence = mod.confidence === 'HIGH' ? '[HIGH]' :
                        mod.confidence === 'MEDIUM' ? '[MED]' : '[LOW]';
      const auto = mod.autoFixable ? 'auto' : 'manual';
      console.log(` ${mod.id.padEnd(18)} ${confidence.padEnd(7)} ${auto.padEnd(7)} ${mod.name}`);
    }
    console.log('');
    return;
  }

  // Get scan data
  let scanResult;
  if (options.rescan) {
    console.log('\n Running fresh scan...\n');
    scanResult = await scanProject(projectPath, {});
  } else {
    const scans = await getRecentScans(projectPath, 1);
    if (scans.length === 0) {
      console.log('\n No scan data found. Running scan first...\n');
      scanResult = await scanProject(projectPath, {});
    } else {
      scanResult = typeof scans[0].raw_data === 'string'
        ? JSON.parse(scans[0].raw_data)
        : scans[0].raw_data || scans[0];
    }
  }

  // Preview mode
  if (options.preview || options.dryRun) {
    if (options.module) {
      const preview = previewModule(options.module, scanResult);
      console.log(`\n Preview: ${preview.module?.name || options.module}\n`);

      if (preview.issues.length === 0) {
        console.log(' No issues found for this module.\n');
        return;
      }

      for (const issue of preview.issues.slice(0, 20)) {
        console.log(` - ${issue.file || issue.name || issue.package}`);
        if (issue.reason) console.log(`   ${issue.reason}`);
      }

      if (preview.issues.length > 20) {
        console.log(` ... and ${preview.issues.length - 20} more`);
      }
      console.log('');
    } else {
      const analysis = analyseAll(scanResult);
      console.log('\n Fix Analysis\n');
      console.log(` Total issues:    ${analysis.summary.totalIssues}`);
      console.log(` Auto-fixable:    ${analysis.summary.autoFixable}`);
      console.log(` High confidence: ${analysis.summary.byConfidence.HIGH}`);
      console.log(` Medium:          ${analysis.summary.byConfidence.MEDIUM}`);
      console.log(` Low:             ${analysis.summary.byConfidence.LOW}`);
      console.log('');

      for (const [moduleId, data] of Object.entries(analysis.results)) {
        if (data.count > 0) {
          console.log(` ${moduleId}: ${data.count} issue(s)`);
        }
      }
      console.log('');
    }
    return;
  }

  // Apply specific module
  if (options.module) {
    console.log(`\n Applying fix: ${options.module}\n`);

    try {
      const result = await applyFix(projectPath, options.module, scanResult, {
        force: options.force,
        includeMajor: options.includeMajor,
        verbose: options.verbose
      });

      if (result.success) {
        console.log(' Fix applied successfully!\n');
        if (result.filesChanged) console.log(` Files changed: ${result.filesChanged}`);
        if (result.filesRemoved) console.log(` Files removed: ${result.filesRemoved}`);
        if (result.bytesSaved) console.log(` Bytes saved:   ${formatBytes(result.bytesSaved)}`);
        if (result.quarantineSession) {
          console.log(` Quarantine:    ${result.quarantineSession}`);
        }
        console.log('');
      } else {
        console.log(` Fix skipped: ${result.error || result.message}\n`);
      }
    } catch (error) {
      console.error(` Fix failed: ${error.message}\n`);
      process.exit(1);
    }
    return;
  }

  // Auto-fix all
  if (options.all) {
    console.log('\n Applying auto-fixes...\n');

    try {
      const result = await autoFix(projectPath, scanResult, {
        includeMedium: options.includeMedium,
        verbose: options.verbose
      });

      console.log(' Auto-fix complete!\n');
      console.log(` Applied: ${result.applied.length}`);
      console.log(` Skipped: ${result.skipped.length}`);
      console.log(` Errors:  ${result.errors.length}`);
      console.log('');

      if (result.applied.length > 0) {
        console.log(' Applied:');
        for (const fix of result.applied) {
          console.log(`   - ${fix.moduleId}`);
        }
        console.log('');
      }

      if (result.quarantineSessions.length > 0) {
        console.log(` Quarantine sessions created: ${result.quarantineSessions.length}`);
        console.log(' Use "swynx quarantine list" to view\n');
      }
    } catch (error) {
      console.error(` Auto-fix failed: ${error.message}\n`);
      process.exit(1);
    }
    return;
  }

  // Default: show analysis
  const analysis = analyseAll(scanResult);
  console.log('\n Fix Analysis\n');
  console.log(` Total issues:    ${analysis.summary.totalIssues}`);
  console.log(` Auto-fixable:    ${analysis.summary.autoFixable}`);
  console.log('');
  console.log(' Use --list to see available modules');
  console.log(' Use --module <id> to apply a specific fix');
  console.log(' Use --all to apply all auto-fixable issues');
  console.log(' Use --preview to see what would change\n');
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

export default fixCommand;
