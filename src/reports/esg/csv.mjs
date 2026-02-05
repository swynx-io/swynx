/**
 * ESG CSV Export
 *
 * Generates CSV format for ESG data.
 */

/**
 * Format date to ISO string
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Escape CSV value
 */
function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate CSV from ESG data
 * @param {object} data - Aggregated ESG data from aggregator
 * @returns {string} CSV content
 */
export function generateESGCSV(data) {
  const lines = [];

  // Metadata header
  lines.push(`report_id,${escapeCSV(data.reportId)}`);
  lines.push(`report_period_start,${formatDate(data.period.start)}`);
  lines.push(`report_period_end,${formatDate(data.period.end)}`);
  lines.push(`generated_at,${data.generatedAt.toISOString()}`);
  lines.push(`organisation,${escapeCSV(data.organisation)}`);
  lines.push(`methodology,${escapeCSV(data.methodology.version)} - ${escapeCSV(data.methodology.framework)}`);
  lines.push(`total_emissions_kg,${data.summary.totalEmissions.toFixed(2)}`);
  lines.push(`total_scans,${data.summary.totalScans}`);
  lines.push(`projects_analysed,${data.summary.projectCount}`);
  lines.push(`emissions_trend_percent,${data.summary.trend.toFixed(1)}`);
  lines.push(`issues_fixed,${data.summary.issuesFixed}`);
  lines.push(`emissions_avoided_kg,${data.summary.emissionsAvoided.toFixed(2)}`);
  lines.push('');

  // Scan data header
  lines.push('scan_id,scan_date,project,emissions_kg,bundle_size_bytes,waste_percentage,vulnerabilities,issues_fixed,health_score');

  // Scan data rows
  for (const project of data.projects) {
    for (const scan of project.scans) {
      lines.push([
        escapeCSV(scan.id),
        formatDate(scan.date),
        escapeCSV(project.name),
        scan.emissions.toFixed(3),
        scan.bundleSize,
        scan.wastePercent.toFixed(1),
        scan.vulnerabilities,
        scan.issuesFixed,
        scan.healthScore
      ].join(','));
    }
  }

  return lines.join('\n');
}

/**
 * Generate summary-only CSV (one row per project)
 * @param {object} data - Aggregated ESG data
 * @returns {string} CSV content
 */
export function generateProjectSummaryCSV(data) {
  const lines = [];

  // Header
  lines.push('project,total_emissions_kg,percent_of_total,scan_count,trend_percent,issues_fixed,emissions_avoided_kg');

  // Data rows
  for (const project of data.projects) {
    lines.push([
      escapeCSV(project.name),
      project.emissions.toFixed(2),
      project.percentOfTotal.toFixed(1),
      project.scanCount,
      project.trend.toFixed(1),
      project.issuesFixed,
      project.emissionsAvoided.toFixed(2)
    ].join(','));
  }

  return lines.join('\n');
}

export default {
  generateESGCSV,
  generateProjectSummaryCSV
};
