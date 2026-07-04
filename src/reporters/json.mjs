/**
 * JSON reporter - machine-readable output.
 * Uses plain-English field names alongside technical identifiers.
 */

/**
 * @param {object} results
 * @param {object} [options]
 * @returns {string}
 */
export function report(results, options = {}) {
  const deadFiles = results.deadFiles || [];
  const deadFunctions = results.deadFunctions || [];
  const unusedExports = results.unusedExports || [];
  const unusedExportCount = unusedExports.reduce((sum, f) => sum + f.deadExports.length, 0);
  const totalUnused = deadFiles.length + deadFunctions.length + unusedExportCount;
  const totalFiles = results.totalFiles || 0;
  const deadBytes = deadFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const deadPct = totalFiles > 0 ? ((deadFiles.length / totalFiles) * 100).toFixed(1) : '0.0';

  const output = {
    summary: {
      totalFilesScanned: totalFiles,
      activeFiles: results.reachableFiles || (totalFiles - deadFiles.length),
      unusedFiles: deadFiles.length,
      unusedFunctions: deadFunctions.length,
      unusedExports: unusedExportCount,
      totalUnused,
      percentUnused: `${deadPct}%`,
      wastedBytes: deadBytes,
      status: totalUnused > 0 ? 'issues-found' : 'clean',
    },
    // Technical classification (for CI/CD and compliance systems)
    classification: {
      id: 'CWE-561',
      name: 'Dead Code',
      reference: 'https://cwe.mitre.org/data/definitions/561.html',
      severity: totalUnused > 0 ? 'warning' : 'none',
    },
    unusedFiles: deadFiles,
    unusedFunctions: deadFunctions,
    unusedExports,
    languages: results.languages || {},
    ...(results.aiSummary ? { aiVerification: results.aiSummary } : {}),
  };

  return JSON.stringify(output, null, 2);
}
