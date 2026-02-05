// src/cli/commands/esg-report.mjs
// ESG Compliance Report CLI Command

import { writeFile } from 'fs/promises';
import {
  generateESGReport,
  getDatePresets,
  logESGExport
} from '../../reports/esg/index.mjs';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const cyan = '\x1b[36m';
const reset = '\x1b[0m';

/**
 * ESG Report CLI Command
 */
export async function esgReportCommand(options) {
  const {
    format = 'pdf',
    output,
    period,
    after,
    before,
    projects
  } = options;

  // Determine output format
  let outputFormat = format;
  if (outputFormat === 'md' || outputFormat === 'esg') {
    outputFormat = 'pdf'; // Default to PDF for ESG
  }

  // Validate format
  if (!['pdf', 'csv', 'json'].includes(outputFormat)) {
    console.error(`\n${yellow}Invalid format: ${outputFormat}${reset}`);
    console.error(`Use: pdf, csv, or json\n`);
    process.exit(1);
  }

  // Parse projects filter
  const projectList = projects ? projects.split(',').map(p => p.trim()) : undefined;

  // Show what we're generating
  console.log(`\n${bold}ESG Compliance Report${reset}\n`);

  if (period) {
    const presets = getDatePresets();
    const preset = presets.find(p => p.value === period);
    console.log(`${dim}Period:${reset}  ${preset ? preset.label : period}`);
  } else if (after && before) {
    console.log(`${dim}Period:${reset}  ${after} to ${before}`);
  } else {
    console.log(`${dim}Period:${reset}  Last 90 days (default)`);
  }

  if (projectList && projectList.length > 0) {
    console.log(`${dim}Projects:${reset} ${projectList.join(', ')}`);
  } else {
    console.log(`${dim}Projects:${reset} All`);
  }

  console.log(`${dim}Format:${reset}  ${outputFormat.toUpperCase()}`);
  console.log('');

  try {
    console.log(`${dim}Aggregating emissions data...${reset}`);

    const result = await generateESGReport({
      format: outputFormat,
      period,
      after,
      before,
      projects: projectList
    });

    // Log the export
    await logESGExport(result.reportData, outputFormat);

    // Determine output path
    let outputPath = output;
    if (!outputPath) {
      outputPath = result.filename;
    }

    // Ensure correct extension
    const ext = outputFormat === 'pdf' ? 'pdf' : outputFormat === 'csv' ? 'csv' : 'json';
    if (!outputPath.endsWith(`.${ext}`)) {
      outputPath = `${outputPath}.${ext}`;
    }

    // Write the file
    await writeFile(outputPath, result.data);

    console.log(`${green}✓${reset} Report saved to: ${bold}${outputPath}${reset}\n`);

    // Show summary
    const data = result.reportData;
    console.log(`${bold}Summary${reset}`);
    console.log(`─────────────────────────────────────────`);
    console.log(`  Total Emissions:   ${bold}${data.summary.totalEmissions.toFixed(1)} kg CO₂e${reset}`);
    console.log(`  Projects:          ${data.summary.projectCount}`);
    console.log(`  Scans Analysed:    ${data.summary.totalScans}`);
    console.log(`  Issues Fixed:      ${data.summary.issuesFixed}`);
    console.log(`  Emissions Avoided: ${data.summary.emissionsAvoided.toFixed(1)} kg CO₂e (annualised)`);

    // Trend indicator
    const trend = data.summary.trend;
    const trendColor = trend < -2 ? green : trend > 2 ? yellow : dim;
    const trendIcon = trend < -2 ? '▼' : trend > 2 ? '▲' : '●';
    console.log(`  Trend:             ${trendColor}${trendIcon} ${Math.abs(trend).toFixed(0)}%${reset}`);
    console.log('');

    // Top emitters
    if (data.projects.length > 0) {
      console.log(`${bold}Top Emitters${reset}`);
      console.log(`─────────────────────────────────────────`);
      for (const project of data.projects.slice(0, 5)) {
        const pctBar = '█'.repeat(Math.round(project.percentOfTotal / 5));
        console.log(`  ${project.name.substring(0, 25).padEnd(25)} ${project.emissions.toFixed(1).padStart(8)} kg  ${dim}${pctBar}${reset}`);
      }
      console.log('');
    }

    console.log(`${dim}Report ID: ${data.reportId}${reset}`);
    console.log(`${dim}Methodology: ${data.methodology.version} - ${data.methodology.framework}${reset}`);
    console.log('');

  } catch (error) {
    console.error(`\n${yellow}Error generating ESG report:${reset} ${error.message}\n`);
    process.exit(1);
  }
}

export default esgReportCommand;
