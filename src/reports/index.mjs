/**
 * Reports Module
 *
 * Generates exportable reports from scan data.
 */

import { generateActionList, extractIssues, generateIssueId } from './action-list.mjs';
import { generateDiff, generateProgressReport } from './diff.mjs';
import { renderActionListMarkdown, renderProgressMarkdown } from './renderers/markdown.mjs';
import { renderActionListCSV, renderProgressCSV } from './renderers/csv.mjs';
import { renderLLMPrompt } from './renderers/llm.mjs';

/**
 * Generate and render an action list report
 *
 * @param {Object} scanData - Scan result data
 * @param {Object} options - Options
 * @param {string} options.format - Output format: 'json' | 'md' | 'csv'
 * @param {Object} options.projectInfo - Project info { name, path }
 * @returns {string|Object} - Rendered report
 */
export function generateReport(scanData, options = {}) {
  const { format = 'json', projectInfo = {} } = options;

  const actionList = generateActionList(scanData, projectInfo);

  switch (format) {
    case 'md':
    case 'markdown':
      return renderActionListMarkdown(actionList);

    case 'csv':
      return renderActionListCSV(actionList);

    case 'llm':
    case 'txt':
      return renderLLMPrompt(actionList);

    case 'json':
    default:
      return actionList;
  }
}

/**
 * Generate and render a progress report (diff between two scans)
 *
 * @param {Object} previousScan - Previous scan data
 * @param {Object} currentScan - Current scan data
 * @param {Object} options - Options
 * @param {string} options.format - Output format: 'json' | 'md' | 'csv'
 * @returns {string|Object} - Rendered report
 */
export function generateDiffReport(previousScan, currentScan, options = {}) {
  const { format = 'json' } = options;

  const diff = generateDiff(previousScan, currentScan);
  const progressReport = generateProgressReport(diff);

  switch (format) {
    case 'md':
    case 'markdown':
      return renderProgressMarkdown(progressReport);

    case 'csv':
      return renderProgressCSV(progressReport);

    case 'json':
    default:
      return progressReport;
  }
}

/**
 * Get content type for format
 */
export function getContentType(format) {
  switch (format) {
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'csv':
      return 'text/csv';
    case 'llm':
    case 'txt':
      return 'text/plain';
    case 'pdf':
      return 'application/pdf';
    case 'json':
    default:
      return 'application/json';
  }
}

/**
 * Get file extension for format
 */
export function getFileExtension(format) {
  switch (format) {
    case 'md':
    case 'markdown':
      return 'md';
    case 'csv':
      return 'csv';
    case 'llm':
    case 'txt':
      return 'txt';
    case 'pdf':
      return 'pdf';
    case 'json':
    default:
      return 'json';
  }
}

export {
  generateActionList,
  extractIssues,
  generateIssueId,
  generateDiff,
  generateProgressReport,
  renderActionListMarkdown,
  renderProgressMarkdown,
  renderActionListCSV,
  renderProgressCSV,
  renderLLMPrompt
};

export default {
  generateReport,
  generateDiffReport,
  getContentType,
  getFileExtension
};
