/**
 * ESG Reports Module
 *
 * Main entry point for ESG compliance reporting.
 */

import { aggregateESGData, parsePeriod, parseCustomRange } from './aggregator.mjs';
import { generateESGCSV, generateProjectSummaryCSV } from './csv.mjs';
import { generateESGPDF } from './pdf.mjs';

/**
 * Generate ESG report
 * @param {object} options
 * @param {string} options.format - 'pdf' | 'csv'
 * @param {string} options.period - Period preset (e.g., '90d', 'Q4-2025')
 * @param {string} options.after - Custom start date (YYYY-MM-DD)
 * @param {string} options.before - Custom end date (YYYY-MM-DD)
 * @param {string[]} options.projects - Filter to specific projects
 * @returns {Promise<{ data: Buffer|string, filename: string, contentType: string, reportData: object }>}
 */
export async function generateESGReport(options = {}) {
  const {
    format = 'pdf',
    period,
    after,
    before,
    projects
  } = options;

  // Determine date range
  let dateRange;
  if (after && before) {
    dateRange = parseCustomRange(after, before);
  } else {
    dateRange = parsePeriod(period || '90d');
  }

  // Aggregate data
  const reportData = await aggregateESGData({
    startDate: dateRange.start,
    endDate: dateRange.end,
    projects
  });

  // Format dates for filename
  const startStr = dateRange.start.toISOString().split('T')[0];
  const endStr = dateRange.end.toISOString().split('T')[0];

  // Generate output based on format
  if (format === 'csv') {
    const data = generateESGCSV(reportData);
    return {
      data,
      filename: `swynx-emissions-${startStr}-to-${endStr}.csv`,
      contentType: 'text/csv',
      reportData
    };
  }

  if (format === 'pdf') {
    const data = await generateESGPDF(reportData);
    return {
      data,
      filename: `swynx-esg-report-${startStr}-to-${endStr}.pdf`,
      contentType: 'application/pdf',
      reportData
    };
  }

  // JSON format (for API)
  return {
    data: JSON.stringify(reportData, null, 2),
    filename: `swynx-emissions-${startStr}-to-${endStr}.json`,
    contentType: 'application/json',
    reportData
  };
}

/**
 * Get available date presets
 */
export function getDatePresets() {
  return [
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: 'this-quarter', label: 'This quarter' },
    { value: 'last-quarter', label: 'Last quarter' },
    { value: 'this-year', label: 'This year' },
    { value: 'last-year', label: 'Last year' }
  ];
}

/**
 * Log ESG report generation to audit log
 * @param {object} reportData - The generated report data
 * @param {string} format - Output format used
 */
export async function logESGExport(reportData, format) {
  // This would append to an audit log file
  // For now, we'll just console log in development
  const logEntry = {
    id: `evt_export_${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    type: 'esg.report.generated',
    details: {
      format,
      periodStart: reportData.period.start.toISOString().split('T')[0],
      periodEnd: reportData.period.end.toISOString().split('T')[0],
      projectsIncluded: reportData.projects.map(p => p.name),
      totalEmissionsKg: reportData.summary.totalEmissions,
      reportId: reportData.reportId
    }
  };

  // Could write to data/audit-log.json here
  if (process.env.NODE_ENV !== 'production') {
    console.log('[ESG Export]', JSON.stringify(logEntry, null, 2));
  }

  return logEntry;
}

export {
  aggregateESGData,
  parsePeriod,
  parseCustomRange,
  generateESGCSV,
  generateProjectSummaryCSV,
  generateESGPDF
};

export default {
  generateESGReport,
  getDatePresets,
  logESGExport,
  aggregateESGData,
  parsePeriod,
  parseCustomRange
};
