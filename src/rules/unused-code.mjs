// src/rules/unused-code.mjs
// Unused/dead code rule

export function checkUnusedCode(deadCode, config = {}) {
  const findings = [];

  // Orphan files
  for (const file of deadCode?.orphanFiles || []) {
    findings.push({
      rule: 'no-dead-code',
      severity: config['no-dead-code'] || 'warning',
      category: 'dead-code',
      message: `Potentially unused file: ${file.file}`,
      filePath: file.file,
      reason: file.reason,
      recommendation: 'Verify file is not used dynamically, then remove'
    });
  }

  // Unused exports
  for (const exp of deadCode?.unusedExports || []) {
    findings.push({
      rule: 'no-unused-exports',
      severity: config['no-unused-exports'] || 'info',
      category: 'dead-code',
      message: `Unused export: ${exp.name} in ${exp.file}`,
      filePath: exp.file,
      exportName: exp.name,
      recommendation: 'Remove unused export or verify it is used externally'
    });
  }

  return findings;
}

export default checkUnusedCode;
