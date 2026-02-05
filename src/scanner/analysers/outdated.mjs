// src/scanner/analysers/outdated.mjs
// Full-depth outdated dependency analysis: health, security fixes, changelogs, recommendations

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

// ============================================================================
// CONSTANTS
// ============================================================================

// Package considered unmaintained if no publish in this many days
const UNMAINTAINED_THRESHOLD_DAYS = 730; // 2 years

// Known migration guides for popular packages
const KNOWN_MIGRATION_GUIDES = {
  'express': 'https://expressjs.com/en/guide/migrating-5.html',
  'react': 'https://react.dev/blog',
  'react-dom': 'https://react.dev/blog',
  'next': 'https://nextjs.org/docs/upgrading',
  'webpack': 'https://webpack.js.org/migrate/',
  'typescript': 'https://www.typescriptlang.org/docs/handbook/release-notes/overview.html',
  'eslint': 'https://eslint.org/docs/latest/use/migrate-to-9.0.0',
  'jest': 'https://jestjs.io/docs/upgrading-to-jest29',
  'mocha': 'https://mochajs.org/#upgrading',
  'vue': 'https://v3-migration.vuejs.org/',
  'angular': 'https://angular.io/guide/updating',
  '@angular/core': 'https://angular.io/guide/updating',
  'svelte': 'https://svelte.dev/docs/v4-migration-guide',
  'gatsby': 'https://www.gatsbyjs.com/docs/reference/release-notes/migrating-from-v4-to-v5/',
  'prisma': 'https://www.prisma.io/docs/guides/upgrade-guides',
  '@prisma/client': 'https://www.prisma.io/docs/guides/upgrade-guides',
  'mongoose': 'https://mongoosejs.com/docs/migrating_to_8.html',
  'sequelize': 'https://sequelize.org/docs/v7/other-topics/upgrade/',
  'lodash': 'https://lodash.com/custom-builds',
  'moment': 'https://momentjs.com/docs/#/-project-status/',
  'axios': 'https://axios-http.com/docs/migration',
  'styled-components': 'https://styled-components.com/docs/faqs#what-do-i-need-to-do-to-migrate-to-v6'
};

// Known deprecated packages and their alternatives
const KNOWN_ALTERNATIVES = {
  'request': [
    { name: 'node-fetch', reason: 'Lightweight, native-like API' },
    { name: 'axios', reason: 'Full-featured, popular' },
    { name: 'got', reason: 'Feature-rich, modern' },
    { name: 'undici', reason: 'Fast, maintained by Node.js' }
  ],
  'moment': [
    { name: 'date-fns', reason: 'Modular, tree-shakeable' },
    { name: 'dayjs', reason: 'Tiny, moment-compatible API' },
    { name: 'luxon', reason: 'By moment team, immutable' }
  ],
  'node-sass': [
    { name: 'sass', reason: 'Dart Sass, the canonical implementation' }
  ],
  'uuid': [], // Not deprecated, but v3 is
  'tslint': [
    { name: 'eslint', reason: 'TSLint is deprecated, use ESLint with TypeScript' },
    { name: '@typescript-eslint/eslint-plugin', reason: 'TypeScript support for ESLint' }
  ],
  'uglify-js': [
    { name: 'terser', reason: 'ES6+ support, actively maintained' },
    { name: 'esbuild', reason: 'Extremely fast, modern' }
  ],
  'left-pad': [
    { name: 'String.prototype.padStart', reason: 'Built-in JavaScript method' }
  ]
};

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Full-depth outdated dependency analysis
 * @param {Object} dependencies - Dependency list from package.json
 * @param {string} projectPath - Path to the project
 * @param {Object} options - Options including onProgress callback
 */
export async function scanOutdatedDependencies(dependencies, projectPath = process.cwd(), options = {}) {
  const onProgress = options.onProgress || (() => {});

  // Check if node_modules exists - skip npm commands if not
  const nodeModulesPath = join(projectPath, 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    console.error('[OUTDATED] Skipping npm outdated - node_modules not found');
    return {
      summary: { total: 0, major: 0, minor: 0, patch: 0, deprecated: 0, unmaintained: 0, withSecurityFixes: 0 },
      packages: [],
      critical: [],
      recommended: [],
      optional: [],
      deprecated: [],
      major: [],
      minor: [],
      patch: [],
      quickWins: [],
      skipped: true,
      skipReason: 'node_modules not found - run npm install first'
    };
  }

  console.error('[OUTDATED] Starting npm outdated...');

  const results = {
    summary: {
      total: 0,
      major: 0,
      minor: 0,
      patch: 0,
      deprecated: 0,
      unmaintained: 0,
      withSecurityFixes: 0
    },
    packages: [],
    critical: [],      // Security fixes needed
    recommended: [],   // Should update soon
    optional: [],      // Can wait
    deprecated: [],    // Need replacement
    major: [],         // Major version updates
    minor: [],         // Minor version updates
    patch: [],         // Patch updates
    quickWins: []
  };

  // Get outdated packages from npm
  const outdatedRaw = await getOutdatedPackages(projectPath);

  if (Object.keys(outdatedRaw).length === 0) {
    return results;
  }

  // Get audit data for security checks
  const auditData = await getAuditData(projectPath);

  // Process each outdated package
  const packageNames = Object.keys(outdatedRaw);
  const totalPackages = packageNames.length;
  let processedPackages = 0;

  for (const [name, data] of Object.entries(outdatedRaw)) {
    processedPackages++;
    onProgress(`Analysing ${name}`, processedPackages, totalPackages);
    results.summary.total++;

    // Get package info from registry
    const registryInfo = await getPackageInfo(name);

    // Analyse package health
    const packageHealth = await getPackageHealth(name, registryInfo, projectPath);

    // Check for security fixes
    const securityFixes = checkSecurityFixes(name, data.current, data.latest, auditData);

    // Get changelog highlights
    const changelog = await getChangelog(name, registryInfo, data.current, data.latest);

    // Check for major version
    const majorVersionAvailable = checkMajorVersion(name, data.current, data.latest, registryInfo);

    // Check dependents in project
    const dependents = checkDependents(name, projectPath);

    // Calculate version info
    const versionInfo = calculateVersionInfo(data.current, data.latest, registryInfo);

    // Calculate effort
    const effort = calculateEffort(
      data.current,
      data.latest,
      changelog,
      securityFixes,
      dependents,
      versionInfo
    );

    // Calculate cost of not updating
    const costOfNotUpdating = calculateCostOfNotUpdating(
      securityFixes,
      versionInfo.daysBehind,
      packageHealth
    );

    // Build recommendation
    const recommendation = buildOutdatedRecommendation(
      { name, ...data, versionsBehind: versionInfo.versionsBehind },
      securityFixes,
      effort,
      packageHealth,
      majorVersionAvailable
    );

    const pkg = {
      package: name,
      current: data.current,
      wanted: data.wanted,
      latest: data.latest,
      latestMajor: majorVersionAvailable.available ? majorVersionAvailable.version : null,
      updateType: versionInfo.updateType,
      versionsBehind: versionInfo.versionsBehind,
      daysBehind: versionInfo.daysBehind,
      currentReleased: versionInfo.currentReleased,
      latestReleased: versionInfo.latestReleased,
      packageHealth,
      securityFixes,
      changelog,
      majorVersionAvailable,
      dependents,
      costOfNotUpdating,
      effort,
      recommendation
    };

    results.packages.push(pkg);

    // Categorise by update type
    results.summary[versionInfo.updateType]++;
    results[versionInfo.updateType].push(pkg);

    // Categorise by status
    if (packageHealth.deprecated) {
      results.deprecated.push(pkg);
      results.summary.deprecated++;
    }

    if (!packageHealth.maintained) {
      results.summary.unmaintained++;
    }

    if (securityFixes.hasSecurityFixes) {
      results.critical.push(pkg);
      results.summary.withSecurityFixes++;
    } else if (recommendation.priority === 'high' || recommendation.priority === 'medium') {
      results.recommended.push(pkg);
    } else {
      results.optional.push(pkg);
    }
  }

  // Sort by priority
  results.critical.sort((a, b) => (b.securityFixes.cves?.length || 0) - (a.securityFixes.cves?.length || 0));
  results.packages.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return (priorityOrder[a.recommendation.priority] || 3) - (priorityOrder[b.recommendation.priority] || 3);
  });

  // Build quick wins
  results.quickWins = buildOutdatedQuickWins(results);

  // Build headline
  results.headline = buildOutdatedHeadline(results.summary);

  // Add totalOutdated for backwards compatibility with frontend
  results.totalOutdated = results.summary.total;

  return results;
}

// ============================================================================
// DATA FETCHING
// ============================================================================

/**
 * Get outdated packages from npm (async to allow heartbeat)
 */
async function getOutdatedPackages(projectPath) {
  try {
    const { stdout } = await execAsync('npm outdated --json 2>/dev/null', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024
    });
    return JSON.parse(stdout || '{}');
  } catch (e) {
    // npm outdated exits with code 1 when packages are outdated
    if (e.stdout) {
      try {
        return JSON.parse(e.stdout);
      } catch {
        return {};
      }
    }
    return {};
  }
}

/**
 * Get npm audit data (async to allow heartbeat)
 */
async function getAuditData(projectPath) {
  try {
    const { stdout } = await execAsync('npm audit --json 2>/dev/null', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024
    });
    return JSON.parse(stdout || '{}');
  } catch (e) {
    if (e.stdout) {
      try {
        return JSON.parse(e.stdout);
      } catch {
        return {};
      }
    }
    return {};
  }
}

// Counter for registry calls - limit to prevent hanging
let registryCallCount = 0;
const MAX_REGISTRY_CALLS = 30;

/**
 * Get package info from npm registry (async to allow heartbeat)
 */
async function getPackageInfo(packageName) {
  // Limit registry calls to prevent hanging on large repos
  if (registryCallCount >= MAX_REGISTRY_CALLS) {
    return null;
  }
  registryCallCount++;

  try {
    const { stdout } = await execAsync(`npm view "${packageName}" --json 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000, // Reduced from 15s to 5s
      maxBuffer: 5 * 1024 * 1024
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Get weekly downloads for a package (async to allow heartbeat)
 */
async function getWeeklyDownloads(packageName) {
  try {
    const { stdout } = await execAsync(
      `curl -s "https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}"`,
      { encoding: 'utf-8', timeout: 5000 }
    );
    const data = JSON.parse(stdout);
    return data.downloads || 0;
  } catch {
    return null;
  }
}

// ============================================================================
// PACKAGE HEALTH
// ============================================================================

/**
 * Analyse package health
 */
async function getPackageHealth(packageName, registryInfo, projectPath) {
  if (!registryInfo) {
    return {
      available: false,
      maintained: true, // Assume maintained if we can't check
      deprecated: false
    };
  }

  const latestVersion = registryInfo['dist-tags']?.latest;
  const lastPublish = registryInfo.time?.[latestVersion];
  const daysSincePublish = lastPublish
    ? Math.floor((Date.now() - new Date(lastPublish).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Check if maintained (published in last 2 years)
  const maintained = daysSincePublish === null || daysSincePublish < UNMAINTAINED_THRESHOLD_DAYS;

  // Check if deprecated
  const deprecated = !!registryInfo.deprecated;
  const deprecationMessage = registryInfo.deprecated || null;

  // Get alternatives if deprecated or known
  let alternatives = [];
  if (deprecated || KNOWN_ALTERNATIVES[packageName]) {
    alternatives = KNOWN_ALTERNATIVES[packageName] || [];

    // If deprecated but no known alternatives, try to parse deprecation message
    if (deprecated && alternatives.length === 0 && deprecationMessage) {
      const suggestedMatch = deprecationMessage.match(/use\s+(\S+)/i);
      if (suggestedMatch) {
        alternatives.push({ name: suggestedMatch[1], reason: 'Suggested in deprecation message' });
      }
    }
  }

  // Get weekly downloads
  const weeklyDownloads = await getWeeklyDownloads(packageName);

  return {
    available: true,
    maintained,
    lastPublish: lastPublish || 'unknown',
    daysSincePublish,
    weeklyDownloads,
    deprecated,
    deprecationMessage,
    alternatives: alternatives.length > 0 ? alternatives : null,
    repository: registryInfo.repository?.url || null,
    homepage: registryInfo.homepage || null,
    license: registryInfo.license || 'unknown',
    engines: registryInfo.engines || null
  };
}

// ============================================================================
// SECURITY FIXES
// ============================================================================

/**
 * Check if update contains security fixes
 */
function checkSecurityFixes(packageName, currentVersion, latestVersion, auditData) {
  const vulns = auditData?.vulnerabilities?.[packageName];

  if (!vulns) {
    return { hasSecurityFixes: false, cves: [] };
  }

  const cves = [];
  const viaList = vulns.via || [];

  for (const via of viaList) {
    if (typeof via === 'object' && via.source) {
      cves.push({
        id: via.source ? `GHSA-${via.source}` : (via.url?.split('/').pop() || 'unknown'),
        severity: via.severity || 'unknown',
        fixedIn: via.range ? parseFixedVersion(via.range) : (vulns.fixAvailable?.version || 'unknown'),
        title: via.title || via.name || 'Security vulnerability',
        url: via.url || null
      });
    }
  }

  // Dedupe by ID
  const uniqueCves = [];
  const seenIds = new Set();
  for (const cve of cves) {
    if (!seenIds.has(cve.id)) {
      seenIds.add(cve.id);
      uniqueCves.push(cve);
    }
  }

  return {
    hasSecurityFixes: uniqueCves.length > 0,
    cves: uniqueCves,
    fixedInVersions: [...new Set(uniqueCves.map(c => c.fixedIn).filter(v => v !== 'unknown'))],
    fixAvailable: vulns.fixAvailable ? {
      version: vulns.fixAvailable.version,
      isSemVerMajor: vulns.fixAvailable.isSemVerMajor || false
    } : null
  };
}

function parseFixedVersion(range) {
  // Parse semver range to find fixed version
  // e.g., ">=4.18.0" -> "4.18.0"
  const match = range.match(/>=?\s*([\d.]+)/);
  return match ? match[1] : 'unknown';
}

// ============================================================================
// CHANGELOG
// ============================================================================

/**
 * Get changelog highlights from GitHub
 */
async function getChangelog(packageName, registryInfo, currentVersion, latestVersion) {
  const repoUrl = registryInfo?.repository?.url;

  if (!repoUrl) {
    return { available: false, reason: 'No repository URL found' };
  }

  // Parse GitHub URL
  const githubMatch = repoUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/);
  if (!githubMatch) {
    return { available: false, reason: 'Not a GitHub repository', repoUrl };
  }

  const [, owner, repo] = githubMatch;
  const cleanRepo = repo.replace(/\.git$/, '');

  try {
    // Get releases from GitHub API (async to allow heartbeat)
    const { stdout } = await execAsync(
      `curl -s "https://api.github.com/repos/${owner}/${cleanRepo}/releases?per_page=15"`,
      { encoding: 'utf-8', timeout: 10000 }
    );

    const releases = JSON.parse(stdout);

    if (!Array.isArray(releases) || releases.length === 0) {
      return { available: false, reason: 'No releases found' };
    }

    // Filter releases between current and latest
    const relevantReleases = releases.filter(r => {
      const version = r.tag_name.replace(/^v/, '');
      return compareVersions(version, currentVersion) > 0 &&
             compareVersions(version, latestVersion) <= 0;
    });

    const highlights = relevantReleases.slice(0, 5).map(release => ({
      version: release.tag_name.replace(/^v/, ''),
      type: getVersionBumpType(release.tag_name),
      date: release.published_at,
      summary: extractSummary(release.body),
      isPrerelease: release.prerelease,
      url: release.html_url
    }));

    // Look for breaking changes
    const breakingChanges = [];
    for (const release of relevantReleases) {
      const changes = extractBreakingChanges(release.body, release.tag_name);
      breakingChanges.push(...changes);
    }

    return {
      available: true,
      source: 'github-releases',
      highlights,
      breakingChanges: breakingChanges.slice(0, 10),
      hasBreakingChanges: breakingChanges.length > 0,
      fullChangelogUrl: `https://github.com/${owner}/${cleanRepo}/releases`
    };

  } catch (error) {
    return { available: false, reason: error.message };
  }
}

function extractSummary(body) {
  if (!body) return 'No release notes';

  // Get first meaningful paragraph
  const lines = body.split('\n').filter(l => {
    const trimmed = l.trim();
    return trimmed &&
           !trimmed.startsWith('#') &&
           !trimmed.startsWith('*') &&
           !trimmed.startsWith('-') &&
           !trimmed.startsWith('|');
  });

  let summary = lines[0] || '';

  // If no plain text, try to get first bullet point
  if (!summary) {
    const bulletLines = body.split('\n').filter(l => l.trim().startsWith('- ') || l.trim().startsWith('* '));
    if (bulletLines.length > 0) {
      summary = bulletLines[0].replace(/^[-*]\s*/, '');
    }
  }

  // Clean markdown
  summary = summary
    .replace(/\*\*/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();

  return summary.length > 150 ? summary.substring(0, 147) + '...' : summary || 'See release notes';
}

function extractBreakingChanges(body, tagName) {
  if (!body) return [];

  const changes = [];
  const lines = body.split('\n');
  const version = tagName.replace(/^v/, '');

  let inBreaking = false;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes('breaking change') || lower.includes('breaking:') || lower.includes('## breaking')) {
      inBreaking = true;
      // If the breaking change header includes the change itself
      const afterColon = line.split(':')[1]?.trim();
      if (afterColon && afterColon.length > 10) {
        changes.push({ version, change: afterColon });
      }
      continue;
    }
    if (inBreaking && (line.trim().startsWith('- ') || line.trim().startsWith('* '))) {
      const change = line.replace(/^[-*]\s*/, '').trim();
      if (change) {
        changes.push({ version, change });
      }
    }
    if (inBreaking && line.startsWith('#') && !line.toLowerCase().includes('breaking')) {
      inBreaking = false;
    }
  }

  return changes;
}

function getVersionBumpType(tagName) {
  const version = tagName.replace(/^v/, '');
  if (version.includes('alpha') || version.includes('beta') || version.includes('rc') || version.includes('-')) {
    return 'prerelease';
  }
  return 'stable';
}

// ============================================================================
// MAJOR VERSION
// ============================================================================

/**
 * Check if a major version upgrade is available
 */
function checkMajorVersion(packageName, currentVersion, latestVersion, registryInfo) {
  if (!currentVersion || !latestVersion) {
    return { available: false };
  }

  const currentMajor = parseInt(currentVersion.split('.')[0], 10);
  const latestMajor = parseInt(latestVersion.split('.')[0], 10);

  if (latestMajor <= currentMajor) {
    return { available: false };
  }

  // Find release date of the major version
  const latestReleaseDate = registryInfo?.time?.[latestVersion];

  // Check for known migration guide
  const migrationGuide = KNOWN_MIGRATION_GUIDES[packageName] || null;

  return {
    available: true,
    version: latestVersion,
    currentMajor,
    latestMajor,
    releasedDate: latestReleaseDate || null,
    migrationGuide,
    recommendation: `Major version upgrade from ${currentMajor}.x to ${latestMajor}.x. Review breaking changes carefully.`
  };
}

// ============================================================================
// DEPENDENTS
// ============================================================================

/**
 * Check what depends on this package in the project
 */
function checkDependents(packageName, projectPath) {
  const lockPath = join(projectPath, 'package-lock.json');

  if (!existsSync(lockPath)) {
    return { inProject: [], count: 0, updateMayAffect: false };
  }

  try {
    const lockContent = JSON.parse(readFileSync(lockPath, 'utf-8'));
    const packages = lockContent.packages || {};
    const dependents = [];

    for (const [pkgPath, pkgData] of Object.entries(packages)) {
      if (pkgPath === '' || pkgPath.includes(`node_modules/${packageName}`)) continue;

      const deps = {
        ...pkgData.dependencies,
        ...pkgData.peerDependencies,
        ...pkgData.optionalDependencies
      };

      if (deps?.[packageName]) {
        const depName = pkgPath
          .replace(/^node_modules\//, '')
          .replace(/\/node_modules\/.*$/, '');

        if (depName && !depName.includes('node_modules') && !dependents.includes(depName)) {
          dependents.push(depName);
        }
      }
    }

    // Also check direct package.json
    const pkgJsonPath = join(projectPath, 'package.json');
    if (existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      const directDeps = Object.keys({
        ...pkgJson.dependencies,
        ...pkgJson.devDependencies,
        ...pkgJson.peerDependencies
      });

      // Filter to only show other packages that depend on this one
      const filteredDependents = dependents.filter(d => !d.startsWith('.') && directDeps.includes(d));

      return {
        inProject: filteredDependents.slice(0, 10),
        count: filteredDependents.length,
        updateMayAffect: filteredDependents.length > 0
      };
    }

    return {
      inProject: dependents.slice(0, 10),
      count: dependents.length,
      updateMayAffect: dependents.length > 0
    };

  } catch {
    return { inProject: [], count: 0, updateMayAffect: false };
  }
}

// ============================================================================
// VERSION CALCULATIONS
// ============================================================================

/**
 * Calculate version information
 */
function calculateVersionInfo(currentVersion, latestVersion, registryInfo) {
  const currentParts = (currentVersion || '0.0.0').split('.').map(p => parseInt(p, 10) || 0);
  const latestParts = (latestVersion || '0.0.0').split('.').map(p => parseInt(p, 10) || 0);

  let updateType = 'patch';
  if (latestParts[0] > currentParts[0]) {
    updateType = 'major';
  } else if (latestParts[1] > currentParts[1]) {
    updateType = 'minor';
  }

  // Count versions between current and latest
  let versionsBehind = 0;
  if (registryInfo?.time) {
    const versions = Object.keys(registryInfo.time)
      .filter(v => v !== 'created' && v !== 'modified' && !v.includes('-'));

    const sortedVersions = versions.sort(compareVersions);
    const currentIndex = sortedVersions.indexOf(currentVersion);
    const latestIndex = sortedVersions.indexOf(latestVersion);

    if (currentIndex !== -1 && latestIndex !== -1) {
      versionsBehind = latestIndex - currentIndex;
    } else {
      // Estimate based on version numbers
      versionsBehind = (latestParts[0] - currentParts[0]) * 10 +
                       (latestParts[1] - currentParts[1]) * 3 +
                       (latestParts[2] - currentParts[2]);
      versionsBehind = Math.max(1, versionsBehind);
    }
  }

  // Calculate days behind
  const currentReleased = registryInfo?.time?.[currentVersion];
  const latestReleased = registryInfo?.time?.[latestVersion];

  let daysBehind = 0;
  if (currentReleased && latestReleased) {
    daysBehind = Math.floor(
      (new Date(latestReleased).getTime() - new Date(currentReleased).getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  return {
    updateType,
    versionsBehind,
    daysBehind,
    currentReleased: currentReleased || null,
    latestReleased: latestReleased || null
  };
}

/**
 * Compare two semver versions
 */
function compareVersions(a, b) {
  const aParts = (a || '0.0.0').split('.').map(p => parseInt(p, 10) || 0);
  const bParts = (b || '0.0.0').split('.').map(p => parseInt(p, 10) || 0);

  for (let i = 0; i < 3; i++) {
    if ((aParts[i] || 0) < (bParts[i] || 0)) return -1;
    if ((aParts[i] || 0) > (bParts[i] || 0)) return 1;
  }
  return 0;
}

// ============================================================================
// EFFORT & COST
// ============================================================================

/**
 * Calculate update effort
 */
function calculateEffort(current, latest, changelog, securityFixes, dependents, versionInfo) {
  const hasBreaking = changelog?.hasBreakingChanges || false;
  const hasManyDependents = dependents?.count > 5;
  const isMajor = versionInfo.updateType === 'major';
  const isMinor = versionInfo.updateType === 'minor';

  let level = 'low';
  let estimatedTime = '5 minutes';
  let codeChangesRequired = false;
  let testingRequired = 'Basic smoke test';

  if (isMajor || hasBreaking) {
    level = 'high';
    estimatedTime = '1-4 hours';
    codeChangesRequired = true;
    testingRequired = 'Full regression test recommended';
  } else if (isMinor && hasManyDependents) {
    level = 'medium';
    estimatedTime = '15-30 minutes';
    testingRequired = 'Test affected features';
  } else if (isMinor) {
    level = 'low';
    estimatedTime = '10 minutes';
    testingRequired = 'Quick smoke test';
  }

  // If security fix, it's worth the effort
  if (securityFixes?.hasSecurityFixes && level === 'high') {
    testingRequired += ' - but security risk justifies effort';
  }

  return {
    level,
    updateType: versionInfo.updateType,
    breakingChanges: hasBreaking,
    breakingChangeCount: changelog?.breakingChanges?.length || 0,
    codeChangesRequired,
    estimatedTime,
    testingRequired,
    dependentsAffected: dependents?.count || 0
  };
}

/**
 * Calculate cost of not updating
 */
function calculateCostOfNotUpdating(securityFixes, daysBehind, packageHealth) {
  const security = securityFixes?.hasSecurityFixes
    ? (securityFixes.cves?.some(c => c.severity === 'critical' || c.severity === 'high') ? 'critical' : 'high')
    : 'low';

  const features = daysBehind > 365 ? 'medium' : 'low';
  const maintenance = daysBehind > 180 ? 'medium' : 'low';

  let technicalDebt = 'Minimal.';
  if (daysBehind > 730) {
    technicalDebt = 'Significant. Multiple major versions may need to be skipped. High risk of incompatibilities.';
  } else if (daysBehind > 365) {
    technicalDebt = 'Growing. Larger upgrade required later. Consider updating soon.';
  } else if (daysBehind > 180) {
    technicalDebt = 'Moderate. Best to stay current.';
  }

  if (packageHealth.deprecated) {
    technicalDebt = 'Critical. Package is deprecated and will not receive security updates.';
  } else if (!packageHealth.maintained) {
    technicalDebt = 'High. Package appears unmaintained. Consider alternatives.';
  }

  return {
    security,
    features,
    maintenance,
    technicalDebt
  };
}

// ============================================================================
// RECOMMENDATIONS
// ============================================================================

/**
 * Build update recommendation
 */
function buildOutdatedRecommendation(pkg, securityFixes, effort, packageHealth, majorVersion) {
  // Deprecated package
  if (packageHealth.deprecated) {
    return {
      action: 'replace',
      priority: 'high',
      confidence: 'high',
      alternatives: packageHealth.alternatives?.map(a => a.name) || [],
      reasoning: `Package is deprecated: "${packageHealth.deprecationMessage}". Migrate to an actively maintained alternative.`
    };
  }

  // Unmaintained package
  if (!packageHealth.maintained && packageHealth.daysSincePublish > UNMAINTAINED_THRESHOLD_DAYS) {
    const years = Math.floor(packageHealth.daysSincePublish / 365);
    return {
      action: 'evaluate',
      priority: 'medium',
      confidence: 'medium',
      alternatives: packageHealth.alternatives?.map(a => a.name) || [],
      reasoning: `Package hasn't been updated in ${years} year${years > 1 ? 's' : ''}. No security updates will be provided. Consider if it's still the right choice.`
    };
  }

  // Has security fixes - critical priority
  if (securityFixes?.hasSecurityFixes) {
    const severities = securityFixes.cves.map(c => c.severity);
    const hasCritical = severities.includes('critical') || severities.includes('high');

    return {
      action: 'update',
      priority: hasCritical ? 'critical' : 'high',
      targetVersion: pkg.latest,
      confidence: 'high',
      command: `npm install ${pkg.name}@${pkg.latest}`,
      reasoning: `Contains ${securityFixes.cves.length} security fix(es): ${securityFixes.cves.map(c => `${c.id} (${c.severity})`).join(', ')}. Update immediately.`
    };
  }

  // Major version update available
  if (effort.updateType === 'major') {
    return {
      action: 'evaluate',
      priority: 'low',
      targetVersion: pkg.latest,
      confidence: 'medium',
      command: `npm install ${pkg.name}@${pkg.latest}`,
      migrationGuide: majorVersion.migrationGuide,
      reasoning: buildMajorUpdateReasoning(pkg, effort, majorVersion)
    };
  }

  // Minor or patch update
  const priority = effort.level === 'high' ? 'medium' : 'low';

  return {
    action: 'update',
    priority,
    targetVersion: pkg.latest,
    confidence: effort.breakingChanges ? 'medium' : 'high',
    command: `npm install ${pkg.name}@${pkg.latest}`,
    reasoning: buildUpdateReasoning(pkg, effort)
  };
}

function buildMajorUpdateReasoning(pkg, effort, majorVersion) {
  const parts = [];

  parts.push(`Major version update available (${majorVersion.currentMajor}.x → ${majorVersion.latestMajor}.x).`);

  if (effort.breakingChangeCount > 0) {
    parts.push(`${effort.breakingChangeCount} breaking change(s) documented.`);
  } else {
    parts.push('Review changelog for breaking changes.');
  }

  if (majorVersion.migrationGuide) {
    parts.push('Migration guide available.');
  }

  parts.push('Schedule for next major sprint or dedicated upgrade session.');

  return parts.join(' ');
}

function buildUpdateReasoning(pkg, effort) {
  const parts = [];

  parts.push(`${pkg.versionsBehind} ${effort.updateType} version(s) behind.`);

  if (effort.breakingChanges) {
    parts.push(`Has ${effort.breakingChangeCount || 'some'} breaking change(s) - review changelog.`);
  } else {
    parts.push('No breaking changes.');
  }

  parts.push(`${effort.level.charAt(0).toUpperCase() + effort.level.slice(1)} effort update.`);

  if (effort.level === 'low') {
    parts.push('Safe to update now.');
  } else if (effort.level === 'medium') {
    parts.push('Schedule for this sprint.');
  } else {
    parts.push('Plan and test carefully.');
  }

  return parts.join(' ');
}

// ============================================================================
// QUICK WINS & SUMMARY
// ============================================================================

/**
 * Build quick wins
 */
function buildOutdatedQuickWins(results) {
  const wins = [];

  // Security updates - highest priority
  if (results.critical.length > 0) {
    const criticalPackages = results.critical.slice(0, 5);
    const totalCves = results.critical.reduce((sum, p) => sum + (p.securityFixes.cves?.length || 0), 0);

    wins.push({
      type: 'security-updates',
      title: `Update ${results.critical.length} package(s) with security fixes`,
      priority: 'critical',
      effort: 'varies',
      cveCount: totalCves,
      packages: criticalPackages.map(p => ({
        name: p.package,
        from: p.current,
        to: p.latest,
        cves: p.securityFixes.cves?.length || 0,
        severity: p.securityFixes.cves?.[0]?.severity || 'unknown'
      })),
      command: results.critical.length === 1
        ? `npm install ${results.critical[0].package}@${results.critical[0].latest}`
        : `npm install ${results.critical.map(p => `${p.package}@${p.latest}`).join(' ')}`
    });
  }

  // Easy patch updates
  const easyPatches = results.patch.filter(p =>
    p.effort.level === 'low' &&
    !p.securityFixes.hasSecurityFixes &&
    !p.packageHealth.deprecated
  );

  if (easyPatches.length > 0) {
    wins.push({
      type: 'patch-updates',
      title: `Apply ${easyPatches.length} patch update(s)`,
      priority: 'low',
      effort: 'low',
      packages: easyPatches.slice(0, 5).map(p => p.package),
      command: 'npm update'
    });
  }

  // Easy minor updates
  const easyMinors = results.minor.filter(p =>
    p.effort.level === 'low' &&
    !p.securityFixes.hasSecurityFixes &&
    !p.packageHealth.deprecated &&
    !p.effort.breakingChanges
  );

  if (easyMinors.length > 0) {
    wins.push({
      type: 'minor-updates',
      title: `${easyMinors.length} safe minor update(s) available`,
      priority: 'low',
      effort: 'low',
      packages: easyMinors.slice(0, 5).map(p => ({
        name: p.package,
        from: p.current,
        to: p.latest
      })),
      command: easyMinors.length <= 3
        ? `npm install ${easyMinors.map(p => `${p.package}@${p.latest}`).join(' ')}`
        : 'npm update'
    });
  }

  // Deprecated packages
  if (results.deprecated.length > 0) {
    wins.push({
      type: 'replace-deprecated',
      title: `Replace ${results.deprecated.length} deprecated package(s)`,
      priority: 'medium',
      effort: 'medium',
      packages: results.deprecated.map(p => ({
        name: p.package,
        message: p.packageHealth.deprecationMessage,
        alternatives: p.packageHealth.alternatives?.map(a => a.name) || []
      }))
    });
  }

  return wins;
}

/**
 * Build headline summary
 */
function buildOutdatedHeadline(summary) {
  const parts = [];

  parts.push(`${summary.total} outdated package${summary.total !== 1 ? 's' : ''}`);

  if (summary.withSecurityFixes > 0) {
    parts.push(`${summary.withSecurityFixes} with security fixes (update now)`);
  }

  if (summary.deprecated > 0) {
    parts.push(`${summary.deprecated} deprecated (needs replacement)`);
  }

  const safeUpdates = summary.total - summary.withSecurityFixes - summary.deprecated;
  if (safeUpdates > 0) {
    parts.push(`${safeUpdates} can be updated when convenient`);
  }

  return parts.join('. ') + '.';
}

// ============================================================================
// EXPORTS
// ============================================================================

export default { scanOutdatedDependencies };
