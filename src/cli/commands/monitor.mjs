// src/cli/commands/monitor.mjs
// Monitor command implementation

import { scanProject } from '../../scanner/index.mjs';
import { saveScan } from '../../storage/index.mjs';

export async function monitorCommand(projectPath, options) {
  const interval = parseInterval(options.interval || '6h');

  console.log(`\n Monitoring ${projectPath}`);
  console.log(` Interval: ${options.interval || '6h'}\n`);

  // Initial scan
  await runScan(projectPath);

  // Set up interval
  setInterval(async () => {
    await runScan(projectPath);
  }, interval);

  // Keep process alive
  console.log(' Press Ctrl+C to stop monitoring\n');
}

async function runScan(projectPath) {
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[${timestamp}] Scanning...`);

  try {
    const result = await scanProject(projectPath, {});
    await saveScan(result);

    console.log(`[${timestamp}] Score: ${result.healthScore.score}/100 | Waste: ${result.summary.wastePercent.toFixed(1)}%`);
  } catch (error) {
    console.error(`[${timestamp}] Error: ${error.message}`);
  }
}

function parseInterval(str) {
  const match = str.match(/^(\d+)(h|m|d)$/);
  if (!match) return 6 * 60 * 60 * 1000; // Default 6 hours

  const [, num, unit] = match;
  const n = parseInt(num, 10);

  switch (unit) {
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return 6 * 60 * 60 * 1000;
  }
}

export default monitorCommand;
