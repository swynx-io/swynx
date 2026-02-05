// src/cli/commands/report.mjs
// Report command implementation - Action Lists & Progress Reports

import { writeFile } from 'fs/promises';
import { basename } from 'path';
import { getRecentScans, getScanById, getAllScans } from '../../storage/index.mjs';
import {
  generateReport,
  generateDiffReport,
  getFileExtension
} from '../../reports/index.mjs';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const cyan = '\x1b[36m';
const reset = '\x1b[0m';

export async function reportCommand(options) {
  const projectPath = options.project || process.cwd();

  // List scans mode
  if (options.listScans) {
    return await listScansCommand(projectPath, options);
  }

  // Get the target scan
  let targetScan;
  if (options.scan) {
    targetScan = await getScanById(options.scan, { includeRaw: true });
    if (!targetScan) {
      console.error(`\n${yellow}Scan not found: ${options.scan}${reset}\n`);
      process.exit(1);
    }
  } else {
    // Get most recent scan
    const scans = await getRecentScans(projectPath, 1, { includeRaw: true });
    if (scans.length === 0) {
      console.error(`\n${yellow}No scans found. Run a scan first:${reset}`);
      console.error(`  swynx scan ${projectPath}\n`);
      process.exit(1);
    }
    targetScan = scans[0];
  }

  // Parse raw data if needed
  if (typeof targetScan.raw_data === 'string') {
    targetScan.raw = JSON.parse(targetScan.raw_data);
  } else if (targetScan.raw_data) {
    targetScan.raw = targetScan.raw_data;
  }

  const format = options.format || 'md';
  const projectInfo = {
    name: targetScan.project_name || basename(targetScan.project_path),
    path: targetScan.project_path
  };

  let report;
  let reportType;

  // Diff mode
  if (options.diff || options.from) {
    reportType = 'progress';
    let previousScan;

    if (options.diff === 'previous' || (!options.diff && !options.from)) {
      // Get the scan before the target
      const scans = await getRecentScans(projectPath, 10, { includeRaw: true });
      const targetIdx = scans.findIndex(s => s.id === targetScan.id);
      if (targetIdx === -1 || targetIdx >= scans.length - 1) {
        console.error(`\n${yellow}No previous scan found for comparison.${reset}\n`);
        process.exit(1);
      }
      previousScan = scans[targetIdx + 1];
    } else {
      const diffId = options.diff || options.from;
      previousScan = await getScanById(diffId, { includeRaw: true });
      if (!previousScan) {
        console.error(`\n${yellow}Scan not found: ${diffId}${reset}\n`);
        console.error(`Use --list-scans to see available scans.\n`);
        process.exit(1);
      }
    }

    // Parse raw data
    if (typeof previousScan.raw_data === 'string') {
      previousScan.raw = JSON.parse(previousScan.raw_data);
    } else if (previousScan.raw_data) {
      previousScan.raw = previousScan.raw_data;
    }

    console.log(`\n${dim}Generating progress report...${reset}`);
    console.log(`${dim}  From: ${previousScan.id} (${formatDate(previousScan.created_at)})${reset}`);
    console.log(`${dim}  To:   ${targetScan.id} (${formatDate(targetScan.created_at)})${reset}\n`);

    report = generateDiffReport(previousScan, targetScan, { format });
  } else {
    // Action list mode
    reportType = 'action-list';
    console.log(`\n${dim}Generating action list...${reset}\n`);
    report = generateReport(targetScan, { format, projectInfo });
  }

  // Output
  if (options.output) {
    const ext = getFileExtension(format);
    let outputPath = options.output;

    // Add extension if not present
    if (!outputPath.endsWith(`.${ext}`)) {
      outputPath = `${outputPath}.${ext}`;
    }

    const content = format === 'json' ? JSON.stringify(report, null, 2) : report;
    await writeFile(outputPath, content);

    console.log(`${green}✓${reset} Report saved to: ${bold}${outputPath}${reset}\n`);

    // Show summary
    if (reportType === 'progress' && report.summary) {
      console.log(`  ${green}✓ Resolved:${reset}   ${report.summary.resolved}`);
      console.log(`  ${yellow}✗ Still open:${reset} ${report.summary.stillOpen}`);
      console.log(`  ${cyan}🆕 New:${reset}       ${report.summary.new}`);
      console.log('');
    } else if (report.summary) {
      console.log(`  Critical: ${report.summary.critical}`);
      console.log(`  High:     ${report.summary.high}`);
      console.log(`  Medium:   ${report.summary.medium}`);
      console.log(`  Low:      ${report.summary.low}`);
      console.log(`  Total:    ${bold}${report.summary.total}${reset}`);
      console.log('');
    }
  } else {
    // Print to stdout
    if (format === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(report);
    }
  }
}

async function listScansCommand(projectPath, options) {
  console.log(`\n${bold}Available scans for ${projectPath}:${reset}\n`);

  const scans = await getRecentScans(projectPath, 20, { includeRaw: false });

  if (scans.length === 0) {
    console.log(`${dim}  No scans found.${reset}\n`);
    return;
  }

  for (let i = 0; i < scans.length; i++) {
    const scan = scans[i];
    const date = formatDate(scan.created_at || scan.scannedAt);
    const health = scan.health_score || scan.healthScore || scan.score || '?';
    const latest = i === 0 ? ` ${cyan}(latest)${reset}` : '';

    console.log(`  ${bold}${scan.id}${reset}  ${date}  Health: ${health}${latest}`);
  }

  console.log(`\n${dim}Use --diff <scan_id> to compare against a specific scan.${reset}\n`);
}

function formatDate(dateStr) {
  if (!dateStr) return 'Unknown';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default reportCommand;
