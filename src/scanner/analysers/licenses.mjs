// src/scanner/analysers/licenses.mjs
// License compliance scanning

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// License categories — comprehensive SPDX identifier coverage
const PERMISSIVE = [
  'MIT', 'ISC', 'Unlicense', 'CC0-1.0', '0BSD',
  'Apache-2.0', 'Apache 2.0', 'Apache-1.1',
  'BSD-2-Clause', 'BSD-3-Clause', 'BSD-3-Clause-No-Nuclear-License', 'BSD*',
  'Artistic-2.0', 'Artistic-1.0',
  'Zlib', 'zlib-acknowledgement',
  'PSF-2.0', 'Python-2.0', 'Python-2.0-complete',
  'BlueOak-1.0.0',
  'CC-BY-3.0', 'CC-BY-4.0',
  'AFL-3.0', 'AFL-2.1',
  'MS-PL', 'MulanPSL-2.0',
  'NCSA', 'UPL-1.0',
  'Unicode-DFS-2016', 'Unicode-3.0',
  'X11', 'curl', 'libpng-2.0',
  'OFL-1.0', 'OFL-1.1',
  'OpenSSL', 'SSLeay',
  'PHP-3.0', 'PHP-3.01',
  'PostgreSQL',
  'W3C', 'W3C-20150513',
  'Zope-2.0', 'ECL-2.0', 'EDL-1.0',
  'Boost-1.0', 'BSL-1.0',
  'WTFPL', 'Fair', 'Beerware',
  'HPND', 'NTP', 'Sendmail', 'TCL', 'Vim',
  'FTL', 'FSFAP', 'ICU', 'SMLNJ',
  'AAL', 'LPPL-1.3c', 'LPPL-1.3a',
  'Naumen', 'Multics', 'Eurosym',
  'blessing', 'DWTFYWTPL',
  'JSON',    // "shall be used for Good, not Evil" — permissive in practice
  'CC-PDDC', 'Public Domain', 'PUBLICDOMAIN',
];

const COPYLEFT = [
  'GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-2.0+',
  'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later', 'GPL-3.0+',
  'LGPL-2.0', 'LGPL-2.0-only', 'LGPL-2.0-or-later', 'LGPL-2.0+',
  'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-2.1+',
  'LGPL-3.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'LGPL-3.0+',
  'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later',
  'MPL-2.0', 'MPL-1.1',
  'EPL-1.0', 'EPL-2.0',
  'EUPL-1.1', 'EUPL-1.2',
  'CDDL-1.0', 'CDDL-1.1',
  'CPL-1.0', 'IPL-1.0',
  'OSL-3.0', 'OSL-2.1',
  'CECILL-2.1',
  'APSL-2.0', 'CPAL-1.0',
  'CC-BY-SA-3.0', 'CC-BY-SA-4.0',
  'RPL-1.5', 'QPL-1.0',
];

const RESTRICTIVE = [
  'SSPL-1.0', 'SSPL',
  'Commons-Clause',
  'CC-BY-NC-1.0', 'CC-BY-NC-2.0', 'CC-BY-NC-3.0', 'CC-BY-NC-4.0',
  'CC-BY-NC-SA-1.0', 'CC-BY-NC-SA-2.0', 'CC-BY-NC-SA-3.0', 'CC-BY-NC-SA-4.0',
  'CC-BY-ND-1.0', 'CC-BY-ND-2.0', 'CC-BY-ND-3.0', 'CC-BY-ND-4.0',
  'Elastic-2.0', 'BSL-1.1',   // Business Source License (time-delayed open source)
  'Sleepycat', 'Watcom-1.0',
];

// Well-known npm packages → license mapping (fallback when node_modules missing)
const KNOWN_LICENSES = {
  'react': 'MIT', 'react-dom': 'MIT', 'react-is': 'MIT',
  'next': 'MIT', 'express': 'MIT', 'koa': 'MIT',
  'typescript': 'Apache-2.0', 'tslib': '0BSD',
  'vue': 'MIT', 'svelte': 'MIT', 'angular': 'MIT',
  'lodash': 'MIT', 'underscore': 'MIT', 'ramda': 'MIT',
  'axios': 'MIT', 'node-fetch': 'MIT', 'got': 'MIT',
  'zod': 'MIT', 'joi': 'BSD-3-Clause', 'yup': 'MIT',
  'framer-motion': 'MIT', 'motion': 'MIT',
  'tailwindcss': 'MIT', 'postcss': 'MIT', 'autoprefixer': 'MIT',
  'tailwind-merge': 'MIT', 'tw-animate-css': 'MIT',
  'class-variance-authority': 'Apache-2.0', 'clsx': 'MIT', 'classnames': 'MIT',
  'lucide-react': 'ISC', 'lucide': 'ISC',
  'wouter': 'ISC', 'react-router': 'MIT', 'react-router-dom': 'MIT',
  'resend': 'MIT', 'nodemailer': 'MIT',
  'vite': 'MIT', 'esbuild': 'MIT', 'webpack': 'MIT', 'rollup': 'MIT', 'parcel': 'MIT',
  'eslint': 'MIT', 'prettier': 'MIT', 'biome': 'MIT',
  'jest': 'MIT', 'vitest': 'MIT', 'mocha': 'MIT', 'chai': 'MIT',
  'commander': 'MIT', 'yargs': 'MIT', 'meow': 'MIT',
  'chalk': 'MIT', 'picocolors': 'ISC', 'kleur': 'MIT',
  'dotenv': 'BSD-2-Clause', 'cross-env': 'MIT',
  'uuid': 'MIT', 'nanoid': 'MIT', 'cuid': 'MIT',
  'date-fns': 'MIT', 'dayjs': 'MIT', 'luxon': 'MIT', 'moment': 'MIT',
  'mongoose': 'MIT', 'prisma': 'Apache-2.0', 'drizzle-orm': 'Apache-2.0',
  'pg': 'MIT', 'mysql2': 'MIT', 'better-sqlite3': 'MIT',
  'jsonwebtoken': 'MIT', 'bcrypt': 'MIT', 'bcryptjs': 'MIT',
  'cors': 'MIT', 'helmet': 'MIT', 'morgan': 'MIT',
  'sharp': 'Apache-2.0', 'jimp': 'MIT',
  'socket.io': 'MIT', 'ws': 'MIT',
  'puppeteer': 'Apache-2.0', 'playwright': 'Apache-2.0',
  'glob': 'ISC', 'minimatch': 'ISC', 'micromatch': 'MIT',
  'fs-extra': 'MIT', 'graceful-fs': 'ISC',
  'debug': 'MIT', 'pino': 'MIT', 'winston': 'MIT',
  'semver': 'ISC', 'ms': 'MIT',
};

/**
 * Classify a license string
 */
function classifyLicense(license) {
  if (!license || license === 'unknown') return 'unknown';

  // Exact match first
  if (PERMISSIVE.includes(license)) return 'permissive';
  if (COPYLEFT.includes(license)) return 'copyleft';
  if (RESTRICTIVE.includes(license)) return 'restrictive';

  // Fuzzy match — handle variations like "MIT License", "(MIT OR Apache-2.0)", etc.
  const upper = license.toUpperCase();

  // Check permissive patterns
  if (upper === 'MIT' || upper === 'MIT LICENSE' || upper.includes('MIT')) return 'permissive';
  if (upper === 'ISC' || upper === 'ISC LICENSE') return 'permissive';
  if (upper.includes('APACHE')) return 'permissive';
  if (upper.includes('BSD')) return 'permissive';
  if (upper === 'UNLICENSE' || upper === 'UNLICENSED') return 'permissive';
  if (upper.includes('CC0') || upper.includes('PUBLIC DOMAIN')) return 'permissive';
  if (upper.includes('0BSD')) return 'permissive';
  if (upper.includes('WTFPL')) return 'permissive';
  if (upper.includes('ZLIB')) return 'permissive';
  if (upper.includes('OFL') || upper.includes('OPEN FONT')) return 'permissive';
  if (upper.includes('BOOST') || upper.includes('BSL-1.0')) return 'permissive';
  if (upper.includes('PYTHON') || upper.includes('PSF')) return 'permissive';
  if (upper.includes('ARTISTIC')) return 'permissive';
  if (upper.includes('POSTGRESQL')) return 'permissive';
  if (upper.includes('W3C')) return 'permissive';
  if (upper.includes('BLUEOAK')) return 'permissive';
  if (upper.includes('UNICODE')) return 'permissive';
  if (upper.includes('JSON')) return 'permissive';
  if (upper.includes('CURL')) return 'permissive';

  // Check copyleft patterns
  if (upper.includes('GPL')) return 'copyleft';
  if (upper.includes('MPL')) return 'copyleft';
  if (upper.includes('EPL')) return 'copyleft';
  if (upper.includes('EUPL')) return 'copyleft';
  if (upper.includes('CDDL')) return 'copyleft';
  if (upper.includes('OSL')) return 'copyleft';
  if (upper.includes('CC-BY-SA')) return 'copyleft';

  // Check restrictive patterns
  if (upper.includes('SSPL')) return 'restrictive';
  if (upper.includes('COMMONS-CLAUSE') || upper.includes('COMMONS CLAUSE')) return 'restrictive';
  if (upper.includes('CC-BY-NC') || upper.includes('CC-BY-ND')) return 'restrictive';
  if (upper.includes('ELASTIC-2') || upper === 'BUSL-1.1') return 'restrictive';

  // SPDX expression — e.g. "(MIT OR Apache-2.0)"
  if (license.includes(' OR ') || license.includes(' AND ')) {
    const parts = license.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/);
    const categories = parts.map(p => classifyLicense(p.trim()));
    // If any part is restrictive, the whole thing is restrictive
    if (categories.includes('restrictive')) return 'restrictive';
    if (categories.includes('copyleft')) return 'copyleft';
    if (categories.includes('permissive')) return 'permissive';
  }

  return 'unknown';
}

/**
 * Try to read license from package-lock.json
 */
function readLicensesFromLockfile(projectPath) {
  const lockMap = {};

  // npm package-lock.json (v2/v3 format)
  const lockPath = join(projectPath, 'package-lock.json');
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      const packages = lock.packages || {};
      for (const [key, val] of Object.entries(packages)) {
        if (!key || key === '') continue;
        // key is like "node_modules/react" or "node_modules/@radix-ui/react-slot"
        const name = key.replace(/^node_modules\//, '');
        if (name && val.license) {
          lockMap[name] = typeof val.license === 'string' ? val.license : val.license.type || 'unknown';
        }
      }
    } catch {}
  }

  return lockMap;
}

/**
 * Scan for license compliance
 */
export async function scanLicenses(dependencies, projectPath) {
  const licenses = [];
  const issues = [];
  const byLicense = {};
  const summary = { permissive: 0, copyleft: 0, restrictive: 0, unknown: 0 };

  // Pre-load license data from package-lock.json as fallback
  const lockfileLicenses = readLicensesFromLockfile(projectPath);

  for (const dep of dependencies) {
    if (dep.declaredIn !== 'dependencies') continue;

    let license = 'unknown';

    // Strategy 1: Read from node_modules package.json
    const pkgPath = join(projectPath, 'node_modules', dep.name, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (typeof pkg.license === 'string') {
          license = pkg.license;
        } else if (pkg.license?.type) {
          license = pkg.license.type;
        } else if (Array.isArray(pkg.licenses)) {
          license = pkg.licenses.map(l => l.type || l).join(' OR ');
        }
      } catch {}
    }

    // Strategy 2: Fallback to package-lock.json
    if (license === 'unknown' && lockfileLicenses[dep.name]) {
      license = lockfileLicenses[dep.name];
    }

    // Strategy 3: Fallback to well-known package map
    if (license === 'unknown') {
      // Try exact match, then try without scope for scoped packages
      const baseName = dep.name.includes('/') ? dep.name.split('/').pop() : dep.name;
      license = KNOWN_LICENSES[dep.name] || KNOWN_LICENSES[baseName] || 'unknown';
    }

    license = license || 'unknown';

    // Group by license for dashboard
    if (!byLicense[license]) {
      byLicense[license] = [];
    }
    byLicense[license].push(dep.name);

    // Categorize using fuzzy matching
    const category = classifyLicense(license);
    summary[category]++;

    if (category === 'copyleft') {
      issues.push({
        package: dep.name,
        license,
        category,
        severity: 'warning',
        message: 'Copyleft license may require source disclosure'
      });
    } else if (category === 'restrictive') {
      issues.push({
        package: dep.name,
        license,
        category,
        severity: 'critical',
        message: 'Restrictive license may have commercial use limitations'
      });
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
    byLicense,
    issues,
    summary,
    total: licenses.length,
    headline: `${licenses.length} production ${licenses.length === 1 ? 'dependency' : 'dependencies'} checked — ${summary.permissive} permissive, ${summary.copyleft} copyleft, ${summary.restrictive} restrictive${summary.unknown > 0 ? `, ${summary.unknown} unknown` : ''}`
  };
}

export default { scanLicenses };
