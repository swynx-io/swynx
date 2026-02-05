// src/scanner/analysers/licenses.mjs
// License compliance scanning

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// License categories
const PERMISSIVE = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Unlicense', 'CC0-1.0'];
const COPYLEFT = ['GPL-2.0', 'GPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'AGPL-3.0', 'MPL-2.0'];
const RESTRICTIVE = ['SSPL', 'Commons-Clause'];

/**
 * Scan for license compliance
 */
export async function scanLicenses(dependencies, projectPath) {
  const licenses = [];
  const issues = [];
  const byLicense = {};  // Group packages by license for dashboard
  const summary = { permissive: 0, copyleft: 0, restrictive: 0, unknown: 0 };

  for (const dep of dependencies) {
    // Only check production dependencies (declaredIn: 'dependencies')
    if (dep.declaredIn !== 'dependencies') continue;

    const pkgPath = join(projectPath, 'node_modules', dep.name, 'package.json');
    let license = 'unknown';

    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        // Handle various license formats
        if (typeof pkg.license === 'string') {
          license = pkg.license;
        } else if (pkg.license?.type) {
          license = pkg.license.type;
        } else if (Array.isArray(pkg.licenses)) {
          license = pkg.licenses.map(l => l.type || l).join(' OR ');
        }
        license = license || 'unknown';
      } catch (e) {
        // Ignore
      }
    }

    // Add to byLicense grouping
    if (!byLicense[license]) {
      byLicense[license] = [];
    }
    byLicense[license].push(dep.name);

    // Categorize
    let category = 'unknown';
    if (PERMISSIVE.includes(license)) {
      category = 'permissive';
      summary.permissive++;
    } else if (COPYLEFT.some(l => license.includes(l))) {
      category = 'copyleft';
      summary.copyleft++;
      issues.push({
        package: dep.name,
        license,
        category,
        severity: 'warning',
        message: 'Copyleft license may require source disclosure'
      });
    } else if (RESTRICTIVE.some(l => license.includes(l))) {
      category = 'restrictive';
      summary.restrictive++;
      issues.push({
        package: dep.name,
        license,
        category,
        severity: 'critical',
        message: 'Restrictive license may have commercial use limitations'
      });
    } else {
      summary.unknown++;
    }

    licenses.push({
      package: dep.name,
      version: dep.version,
      license,
      category
    });
  }

  return {
    licenses,
    byLicense,  // Dashboard expects this format
    issues,
    summary,
    total: licenses.length
  };
}

export default { scanLicenses };
