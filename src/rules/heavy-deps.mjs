// src/rules/heavy-deps.mjs
// Heavy dependencies rule

const KNOWN_HEAVY = {
  'moment': { size: 290000, alternative: 'date-fns or dayjs' },
  'lodash': { size: 530000, alternative: 'lodash-es or individual imports' },
  'jquery': { size: 87000, alternative: 'vanilla JS' }
};

export function checkHeavyDeps(dependencies, config = {}) {
  const findings = [];

  for (const dep of dependencies || []) {
    if (dep.declaredIn !== 'dependencies') continue;

    const known = KNOWN_HEAVY[dep.name];
    if (known) {
      findings.push({
        rule: 'no-heavy-deps',
        severity: config['no-heavy-deps'] || 'warning',
        category: 'dependencies',
        message: `Heavy dependency: ${dep.name} (~${Math.round(known.size / 1024)}KB)`,
        package: dep.name,
        sizeImpactBytes: known.size,
        recommendation: `Consider ${known.alternative}`
      });
    }
  }

  return findings;
}

export default checkHeavyDeps;
