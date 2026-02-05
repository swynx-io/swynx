// src/reporter/index.mjs

import { formatConsoleOutput } from './console.mjs';
import { formatJsonOutput } from './json.mjs';
import { formatHtmlOutput } from './html.mjs';
import { formatCIOutput } from './ci.mjs';
import { writeFile } from 'fs/promises';

/**
 * Generate report in specified format
 */
export async function generateReport(result, options = {}) {
  const format = options.format || 'console';
  let output;

  switch (format) {
    case 'json':
      output = formatJsonOutput(result, options);
      break;
    case 'html':
      output = formatHtmlOutput(result, options);
      break;
    case 'console':
    default:
      output = formatConsoleOutput(result, options);
      break;
  }

  // Write to file if specified
  if (options.file) {
    await writeFile(options.file, output, 'utf-8');
  }

  return output;
}

/**
 * Print report to console
 */
export function printReport(result, options = {}) {
  const output = formatConsoleOutput(result, options);
  console.log(output);
}

// Re-export formatters
export { formatConsoleOutput, formatJsonOutput, formatHtmlOutput, formatCIOutput };

export default {
  generateReport,
  printReport,
  formatConsoleOutput,
  formatJsonOutput,
  formatHtmlOutput,
  formatCIOutput
};
