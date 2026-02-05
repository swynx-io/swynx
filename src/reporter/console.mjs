// src/reporter/console.mjs
// Console format output

export function formatConsoleOutput(result, options = {}) {
  const lines = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('                    CODEBASE AUDIT REPORT                       ');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  lines.push(`Project:      ${result.projectPath}`);
  lines.push(`Scanned:      ${result.scannedAt}`);
  lines.push('');

  lines.push('─── Summary ───────────────────────────────────────────────────');
  lines.push('');
  lines.push(`Total Files:      ${result.summary.fileCount}`);
  lines.push(`JavaScript:       ${result.summary.jsFileCount}`);
  lines.push(`CSS:              ${result.summary.cssFileCount}`);
  lines.push(`Assets:           ${result.summary.assetFileCount}`);
  lines.push('');
  lines.push(`Total Size:       ${formatBytes(result.summary.totalSizeBytes)}`);
  lines.push(`Waste:            ${formatBytes(result.summary.wasteSizeBytes)} (${result.summary.wastePercent.toFixed(1)}%)`);
  lines.push('');
  lines.push(`Health Score:     ${result.healthScore.score}/100 (${result.healthScore.grade})`);
  lines.push('');

  // Emissions
  if (result.emissions) {
    lines.push('─── Emissions ─────────────────────────────────────────────────');
    lines.push('');
    lines.push(`Monthly CO2:      ${result.emissions.current?.monthlyCO2Kg?.toFixed(2) || 0} kg`);
    lines.push(`Annual CO2:       ${result.emissions.current?.annualCO2Kg?.toFixed(2) || 0} kg`);
    lines.push('');
  }

  // Findings
  const criticalCount = result.findings?.critical?.length || 0;
  const warningCount = result.findings?.warning?.length || 0;
  const infoCount = result.findings?.info?.length || 0;

  if (criticalCount > 0 || warningCount > 0 || infoCount > 0) {
    lines.push('─── Findings ──────────────────────────────────────────────────');
    lines.push('');
    if (criticalCount > 0) lines.push(`Critical:         ${criticalCount}`);
    if (warningCount > 0) lines.push(`Warning:          ${warningCount}`);
    if (infoCount > 0) lines.push(`Info:             ${infoCount}`);
    lines.push('');

    // Show top findings
    const allFindings = [
      ...(result.findings?.critical || []).map(f => ({ ...f, level: 'CRITICAL' })),
      ...(result.findings?.warning || []).map(f => ({ ...f, level: 'WARNING' })),
    ];

    if (allFindings.length > 0) {
      lines.push('Top Issues:');
      for (const finding of allFindings.slice(0, 10)) {
        lines.push(`  [${finding.level}] ${finding.message}`);
        if (finding.file) lines.push(`             ${finding.file}`);
      }
      lines.push('');
    }
  }

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export default formatConsoleOutput;
