// src/reporter/html.mjs
// HTML format output

export function formatHtmlOutput(result, options = {}) {
  const criticalCount = result.findings?.critical?.length || 0;
  const warningCount = result.findings?.warning?.length || 0;
  const infoCount = result.findings?.info?.length || 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Codebase Audit Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 2rem;
      line-height: 1.6;
    }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 1.8rem; margin-bottom: 0.5rem; color: #fff; }
    .subtitle { color: #94a3b8; margin-bottom: 2rem; }
    .card {
      background: #1e293b;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .card-title {
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin-bottom: 1rem;
    }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; }
    .stat { }
    .stat-label { font-size: 0.8rem; color: #94a3b8; }
    .stat-value { font-size: 1.5rem; font-weight: 600; color: #fff; }
    .score {
      font-size: 3rem;
      font-weight: 700;
      background: linear-gradient(135deg, #10b981, #3b82f6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .grade {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.2);
      color: #10b981;
      margin-left: 0.5rem;
    }
    .waste-bar {
      height: 8px;
      background: #334155;
      border-radius: 4px;
      overflow: hidden;
      margin-top: 0.5rem;
    }
    .waste-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #f59e0b);
      border-radius: 4px;
    }
    .findings-list { }
    .finding {
      padding: 0.75rem;
      border-radius: 8px;
      margin-bottom: 0.5rem;
    }
    .finding.critical { background: rgba(239, 68, 68, 0.15); border-left: 3px solid #ef4444; }
    .finding.warning { background: rgba(245, 158, 11, 0.15); border-left: 3px solid #f59e0b; }
    .finding.info { background: rgba(59, 130, 246, 0.15); border-left: 3px solid #3b82f6; }
    .finding-level {
      font-size: 0.7rem;
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    .finding.critical .finding-level { color: #ef4444; }
    .finding.warning .finding-level { color: #f59e0b; }
    .finding.info .finding-level { color: #3b82f6; }
    .finding-message { color: #e2e8f0; }
    .finding-file { font-size: 0.8rem; color: #64748b; margin-top: 0.25rem; font-family: monospace; }
    footer { text-align: center; color: #64748b; font-size: 0.8rem; margin-top: 2rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Codebase Audit Report</h1>
    <p class="subtitle">${result.projectPath} &mdash; ${new Date(result.scannedAt).toLocaleString()}</p>

    <div class="card">
      <div class="card-title">Health Score</div>
      <div>
        <span class="score">${result.healthScore.score}</span>
        <span class="grade">${result.healthScore.grade}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Summary</div>
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">Total Files</div>
          <div class="stat-value">${result.summary.fileCount}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Total Size</div>
          <div class="stat-value">${formatBytes(result.summary.totalSizeBytes)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Waste</div>
          <div class="stat-value">${formatBytes(result.summary.wasteSizeBytes)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Waste %</div>
          <div class="stat-value">${result.summary.wastePercent.toFixed(1)}%</div>
        </div>
      </div>
      <div class="waste-bar">
        <div class="waste-fill" style="width: ${Math.min(result.summary.wastePercent, 100)}%"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">File Breakdown</div>
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">JavaScript</div>
          <div class="stat-value">${result.summary.jsFileCount}</div>
        </div>
        <div class="stat">
          <div class="stat-label">CSS</div>
          <div class="stat-value">${result.summary.cssFileCount}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Assets</div>
          <div class="stat-value">${result.summary.assetFileCount}</div>
        </div>
      </div>
    </div>

    ${result.emissions ? `
    <div class="card">
      <div class="card-title">Carbon Emissions</div>
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">Monthly CO2</div>
          <div class="stat-value">${(result.emissions.current?.monthlyCO2Kg || 0).toFixed(2)} kg</div>
        </div>
        <div class="stat">
          <div class="stat-label">Annual CO2</div>
          <div class="stat-value">${(result.emissions.current?.annualCO2Kg || 0).toFixed(2)} kg</div>
        </div>
      </div>
    </div>
    ` : ''}

    ${(criticalCount > 0 || warningCount > 0 || infoCount > 0) ? `
    <div class="card">
      <div class="card-title">Findings (${criticalCount + warningCount + infoCount})</div>
      <div class="findings-list">
        ${(result.findings?.critical || []).map(f => `
          <div class="finding critical">
            <div class="finding-level">Critical</div>
            <div class="finding-message">${escapeHtml(f.message)}</div>
            ${f.file ? `<div class="finding-file">${escapeHtml(f.file)}</div>` : ''}
          </div>
        `).join('')}
        ${(result.findings?.warning || []).map(f => `
          <div class="finding warning">
            <div class="finding-level">Warning</div>
            <div class="finding-message">${escapeHtml(f.message)}</div>
            ${f.file ? `<div class="finding-file">${escapeHtml(f.file)}</div>` : ''}
          </div>
        `).join('')}
        ${(result.findings?.info || []).slice(0, 10).map(f => `
          <div class="finding info">
            <div class="finding-level">Info</div>
            <div class="finding-message">${escapeHtml(f.message)}</div>
            ${f.file ? `<div class="finding-file">${escapeHtml(f.file)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <footer>
      Generated by Codebase Audit &mdash; ${new Date().toISOString()}
    </footer>
  </div>
</body>
</html>`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default formatHtmlOutput;
