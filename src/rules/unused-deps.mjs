// src/rules/unused-deps.mjs
// Unused dependencies rule

export function checkUnusedDeps(unusedDeps, config = {}) {
  const findings = [];

  for (const dep of unusedDeps || []) {
    findings.push({
      rule: 'no-unused-deps',
      severity: config['no-unused-deps'] || 'warning',
      category: 'dependencies',
      message: `Unused dependency: ${dep.name}`,
      package: dep.name,
      version: dep.version,
      sizeImpactBytes: dep.sizeBytes || 0,
      recommendation: 'Remove from package.json if not needed'
    });
  }

  return findings;
}

export default checkUnusedDeps;
