/**
 * CSV Renderer
 *
 * Renders action lists and progress reports as CSV for import into
 * Jira, Linear, Asana, Excel, etc.
 */

/**
 * Escape CSV field
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
 * Render action list as CSV
 */
export function renderActionListCSV(actionList) {
  const { meta, issues } = actionList;

  const headers = [
    'severity',
    'category',
    'title',
    'description',
    'file',
    'line',
    'fix_command',
    'effort',
    'impact_cost',
    'impact_co2',
    'impact_bytes',
    'cve',
    'exploitable',
    'status',
    'project',
    'scan_id',
    'scan_date',
    'export_name',
    'export_type',
    'export_line',
    'export_status',
    'imported_by'
  ];

  const rows = [headers.join(',')];

  for (const issue of issues) {
    const baseRow = [
      escapeCSV(issue.severity),
      escapeCSV(issue.category),
      escapeCSV(issue.title),
      escapeCSV(issue.description),
      escapeCSV(issue.file),
      escapeCSV(issue.line || ''),
      escapeCSV(issue.fix?.command || ''),
      escapeCSV(issue.fix?.effort || ''),
      escapeCSV(issue.impact?.cost || ''),
      escapeCSV(issue.impact?.co2 || ''),
      escapeCSV(issue.impact?.bytes || ''),
      escapeCSV(issue.cve || ''),
      escapeCSV(issue.exploitable !== undefined ? (issue.exploitable ? 'yes' : 'no') : ''),
      escapeCSV('open'),
      escapeCSV(meta.project),
      escapeCSV(meta.scanId),
      escapeCSV(meta.scanDate)
    ];

    // For dead code issues with per-export detail, emit one row per export
    const hasExports = (issue.category === 'dead-code' || issue.category === 'dead-exports') &&
      issue.exports?.length > 0 && typeof issue.exports[0] === 'object';

    if (hasExports) {
      for (const exp of issue.exports) {
        rows.push([
          ...baseRow,
          escapeCSV(exp.name || ''),
          escapeCSV(exp.type || ''),
          escapeCSV(exp.line || ''),
          escapeCSV(exp.status || (issue.category === 'dead-code' ? 'dead' : '')),
          escapeCSV((exp.importedBy || []).slice(0, 5).join('; '))
        ].join(','));
      }
    } else {
      rows.push([...baseRow, '', '', '', '', ''].join(','));
    }
  }

  return rows.join('\n');
}

/**
 * Render progress report as CSV
 */
export function renderProgressCSV(progressReport) {
  const { meta, resolved, stillOpen, new: newIssues } = progressReport;

  const headers = [
    'status',
    'severity',
    'category',
    'title',
    'description',
    'file',
    'fix_command',
    'effort',
    'days_open',
    'first_seen',
    'resolved_in',
    'project',
    'current_scan',
    'previous_scan'
  ];

  const rows = [headers.join(',')];

  // Resolved issues
  for (const issue of resolved) {
    const row = [
      'resolved',
      escapeCSV(issue.severity),
      escapeCSV(issue.category),
      escapeCSV(issue.title),
      escapeCSV(issue.description),
      escapeCSV(issue.file),
      escapeCSV(issue.fix?.command || ''),
      escapeCSV(issue.fix?.effort || ''),
      '',
      '',
      escapeCSV(issue.resolvedIn),
      escapeCSV(meta.project),
      escapeCSV(meta.currentScan.id),
      escapeCSV(meta.previousScan.id)
    ];
    rows.push(row.join(','));
  }

  // Still open issues
  for (const issue of stillOpen) {
    const row = [
      'open',
      escapeCSV(issue.severity),
      escapeCSV(issue.category),
      escapeCSV(issue.title),
      escapeCSV(issue.description),
      escapeCSV(issue.file),
      escapeCSV(issue.fix?.command || ''),
      escapeCSV(issue.fix?.effort || ''),
      escapeCSV(issue.daysOpen || ''),
      escapeCSV(issue.firstSeen || ''),
      '',
      escapeCSV(meta.project),
      escapeCSV(meta.currentScan.id),
      escapeCSV(meta.previousScan.id)
    ];
    rows.push(row.join(','));
  }

  // New issues
  for (const issue of newIssues) {
    const row = [
      'new',
      escapeCSV(issue.severity),
      escapeCSV(issue.category),
      escapeCSV(issue.title),
      escapeCSV(issue.description),
      escapeCSV(issue.file),
      escapeCSV(issue.fix?.command || ''),
      escapeCSV(issue.fix?.effort || ''),
      '0',
      escapeCSV(meta.currentScan.date),
      '',
      escapeCSV(meta.project),
      escapeCSV(meta.currentScan.id),
      escapeCSV(meta.previousScan.id)
    ];
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

export default {
  renderActionListCSV,
  renderProgressCSV
};
