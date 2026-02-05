// src/scanner/analysers/security.mjs
// Deep security vulnerability scanning with actual risk assessment

import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

// Load vulnerable functions database
const __dirname = dirname(fileURLToPath(import.meta.url));
let vulnerableFunctionsDB = {};
try {
  const dbPath = join(__dirname, '..', '..', 'data', 'vulnerable-functions.json');
  if (existsSync(dbPath)) {
    vulnerableFunctionsDB = JSON.parse(readFileSync(dbPath, 'utf-8'));
  }
} catch (e) {
  // Continue without DB
}

/**
 * Main security vulnerability scanner with deep analysis
 */
export async function scanSecurityVulnerabilities(dependencies, projectPath = null, jsAnalysis = []) {
  // Check if node_modules exists - skip npm commands if not
  const nodeModulesPath = projectPath ? join(projectPath, 'node_modules') : 'node_modules';
  const hasNodeModules = existsSync(nodeModulesPath);

  if (!hasNodeModules) {
    console.error('[SECURITY] Skipping npm audit - node_modules not found');
    return {
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, actuallyExploitable: 0, notExploitable: 0 },
      vulnerabilities: [],
      byPackage: {},
      critical: [],
      high: [],
      medium: [],
      low: [],
      skipped: true,
      skipReason: 'node_modules not found - run npm install first'
    };
  }

  console.error('[SECURITY] Starting npm audit...');

  const results = {
    summary: {
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      actuallyExploitable: 0,
      auditFlagsOnly: 0,
      noRisk: 0
    },
    vulnerabilities: [],
    byPackage: {},
    critical: [],
    high: [],
    medium: [],
    low: []
  };

  // Run npm audit (async to allow event loop/heartbeat to run)
  let auditData;
  try {
    const { stdout } = await execAsync('npm audit --json 2>/dev/null', {
      cwd: projectPath || process.cwd(),
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large audit outputs
    });
    auditData = JSON.parse(stdout);
  } catch (e) {
    // npm audit exits non-zero when vulnerabilities found
    if (e.stdout) {
      try {
        auditData = JSON.parse(e.stdout);
      } catch {
        return {
          ...results,
          error: 'Failed to parse npm audit output'
        };
      }
    } else {
      return {
        ...results,
        error: 'Failed to run npm audit: ' + e.message
      };
    }
  }

  // Process vulnerabilities
  const vulns = auditData.vulnerabilities || {};

  for (const [packageName, vulnData] of Object.entries(vulns)) {
    if (!vulnData.via || vulnData.via.length === 0) continue;

    // Get installed version
    const installedVersion = getInstalledVersion(packageName, projectPath);
    const latestVersion = await getLatestVersionCached(packageName);

    // Process each vulnerability for this package
    const packageVulns = [];

    for (const via of vulnData.via) {
      if (typeof via === 'string') continue; // Skip dependency references

      const enriched = await enrichVulnerabilityInternal(
        via,
        packageName,
        installedVersion,
        jsAnalysis,
        projectPath
      );

      packageVulns.push(enriched);

      // Update summary counts
      results.summary.total++;
      results.summary[enriched.severity] = (results.summary[enriched.severity] || 0) + 1;

      // Track actual risk
      if (enriched.evidence.actualRisk === 'high') {
        results.summary.actuallyExploitable++;
      } else if (enriched.evidence.actualRisk === 'low') {
        results.summary.auditFlagsOnly++;
      } else if (enriched.evidence.actualRisk === 'none') {
        results.summary.noRisk++;
      }

      // Add to severity arrays
      if (enriched.severity === 'critical') results.critical.push(enriched);
      else if (enriched.severity === 'high') results.high.push(enriched);
      else if (enriched.severity === 'medium') results.medium.push(enriched);
      else results.low.push(enriched);

      results.vulnerabilities.push(enriched);
    }

    // Store by package
    results.byPackage[packageName] = {
      installedVersion,
      latestVersion,
      isDirect: vulnData.isDirect || false,
      severity: vulnData.severity,
      vulnerabilities: packageVulns,
      summary: {
        total: packageVulns.length,
        actuallyExploitable: packageVulns.filter(v => v.evidence.actualRisk === 'high').length,
        auditFlagsOnly: packageVulns.filter(v => v.evidence.actualRisk === 'low').length
      }
    };
  }

  // Sort vulnerabilities by actual risk first, then severity
  results.vulnerabilities.sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2, none: 3, unknown: 4 };
    const riskDiff = (riskOrder[a.evidence.actualRisk] || 4) - (riskOrder[b.evidence.actualRisk] || 4);
    if (riskDiff !== 0) return riskDiff;

    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return (sevOrder[a.severity] || 3) - (sevOrder[b.severity] || 3);
  });

  // Build headline
  results.summary.headline = buildSecurityHeadline(results.summary);

  return results;
}

/**
 * Enrich a single vulnerability with deep analysis
 */
async function enrichVulnerabilityInternal(vuln, packageName, installedVersion, jsAnalysis, projectPath) {
  // Get vulnerable function info from our database
  const cveId = vuln.cve || vuln.id || `GHSA-${vuln.source || 'unknown'}`;
  const vulnFuncInfo = vulnerableFunctionsDB[packageName]?.[cveId] ||
                       findMatchingCVE(packageName, cveId);

  // Analyse actual usage
  const usageAnalysis = await analyseVulnerableFunctionUsage(
    packageName,
    cveId,
    vulnFuncInfo,
    jsAnalysis,
    projectPath
  );

  // Determine actual risk level
  const { actualRisk, riskExplanation } = determineActualRisk(
    vuln,
    packageName,
    usageAnalysis
  );

  // Get fix information
  const fixInfo = buildFixInfo(vuln, packageName, installedVersion, vulnFuncInfo);

  // Build recommendation
  const recommendation = buildSecurityRecommendation(
    vuln,
    packageName,
    installedVersion,
    actualRisk,
    usageAnalysis,
    fixInfo
  );

  return {
    id: cveId,
    package: packageName,
    installedVersion,
    title: vuln.title || vuln.name || cveId,
    severity: vuln.severity || 'medium',
    severityScore: vuln.cvss?.score || getSeverityScore(vuln.severity),
    cweId: extractCWE(vuln),
    cweTitle: getCWETitle(extractCWE(vuln)),

    description: vuln.overview || vuln.title || 'No description available',

    affected: {
      versions: vuln.range || vuln.vulnerable_versions || 'unknown',
      youAreAffected: true, // npm audit already determined this
      function: vulnFuncInfo?.functions?.join(', ') || 'unknown',
      attackVector: vulnFuncInfo?.attackVector || 'See CVE details',
      exploitability: usageAnalysis.vulnerableFunctionUsed
        ? 'Vulnerable function is used in your code'
        : 'Vulnerable function not detected in your code'
    },

    evidence: {
      filesSearched: jsAnalysis.length,
      searchPatterns: usageAnalysis.searchPatterns || [],
      matchesFound: usageAnalysis.matchesFound || 0,
      locations: usageAnalysis.locations || [],
      vulnerableFunctionUsed: usageAnalysis.vulnerableFunctionUsed || false,
      packageImported: usageAnalysis.packageImported || false,
      importLocations: usageAnalysis.importLocations || [],
      actualRisk,
      riskExplanation
    },

    fix: fixInfo,

    references: buildReferences(vuln, cveId),

    compliance: {
      failsAudit: true,
      auditNote: actualRisk === 'low' || actualRisk === 'none'
        ? 'Will flag in security scans. Update to clear audit even though actual risk is low.'
        : 'Critical finding. Update immediately.',
      willBlockDeploy: vuln.severity === 'critical' || (vuln.severity === 'high' && actualRisk === 'high'),
      pciDss: vuln.severity === 'critical' || vuln.severity === 'high'
        ? 'May flag in PCI-DSS compliance scans'
        : null,
      soc2: 'Should be documented in vulnerability management process'
    },

    recommendation
  };
}

/**
 * Analyse if vulnerable functions are actually used in the codebase
 */
async function analyseVulnerableFunctionUsage(packageName, cveId, vulnFuncInfo, jsAnalysis, projectPath) {
  const result = {
    dataAvailable: false,
    packageImported: false,
    importLocations: [],
    vulnerableFunctionUsed: false,
    allUsageVulnerable: false,
    searchPatterns: [],
    matchesFound: 0,
    locations: []
  };

  // First check if the package is imported at all
  for (const file of jsAnalysis) {
    const content = file.content || '';
    const filePath = file.file?.relativePath || file.file;

    // Check various import patterns
    const importPatterns = [
      new RegExp(`import\\s+.*from\\s*['"]${escapeRegex(packageName)}(?:/[^'"]*)?['"]`, 'g'),
      new RegExp(`require\\s*\\(\\s*['"]${escapeRegex(packageName)}(?:/[^'"]*)?['"]\\s*\\)`, 'g'),
      new RegExp(`import\\s*\\(\\s*['"]${escapeRegex(packageName)}(?:/[^'"]*)?['"]\\s*\\)`, 'g')
    ];

    for (const pattern of importPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        result.packageImported = true;

        // Find line numbers
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (pattern.test(line)) {
            result.importLocations.push({
              file: filePath,
              line: idx + 1,
              code: line.trim().slice(0, 100)
            });
          }
        });
      }
    }
  }

  // If no vulnerable function info, assume all usage is potentially vulnerable
  if (!vulnFuncInfo) {
    result.dataAvailable = false;

    if (result.packageImported) {
      result.allUsageVulnerable = true;
      result.note = 'No function-level data for this CVE. All usage may be vulnerable.';
    }

    return result;
  }

  result.dataAvailable = true;
  result.searchPatterns = vulnFuncInfo.importPatterns || [];

  // If all functions are vulnerable (marked with *)
  if (vulnFuncInfo.functions?.includes('*') || vulnFuncInfo.importPatterns?.includes('*')) {
    result.allUsageVulnerable = true;
    result.vulnerableFunctionUsed = result.packageImported;
    result.note = vulnFuncInfo.note || 'All usage of this package is potentially vulnerable';

    if (result.packageImported) {
      result.locations = result.importLocations;
      result.matchesFound = result.importLocations.length;
    }

    return result;
  }

  // Search for specific vulnerable function patterns
  const patterns = (vulnFuncInfo.importPatterns || []).map(p => {
    try {
      // Convert simple patterns to regex
      const escaped = escapeRegex(p).replace(/\\\*/g, '.*');
      return new RegExp(escaped, 'g');
    } catch {
      return null;
    }
  }).filter(Boolean);

  for (const file of jsAnalysis) {
    const content = file.content || '';
    const filePath = file.file?.relativePath || file.file;
    const lines = content.split('\n');

    for (const pattern of patterns) {
      lines.forEach((line, idx) => {
        // Reset regex state
        pattern.lastIndex = 0;

        if (pattern.test(line)) {
          result.vulnerableFunctionUsed = true;
          result.matchesFound++;

          // Determine which function matched
          const matchedFunc = vulnFuncInfo.functions?.find(f =>
            line.includes(f + '(') || line.includes('.' + f + '(')
          );

          result.locations.push({
            file: filePath,
            line: idx + 1,
            code: line.trim().slice(0, 100),
            function: matchedFunc || 'unknown',
            pattern: pattern.toString()
          });
        }
      });
    }
  }

  return result;
}

/**
 * Determine actual risk level based on usage analysis
 */
function determineActualRisk(vuln, packageName, usageAnalysis) {
  // If package isn't imported, lower risk but still report it
  // It could be a transitive dependency or an unused direct dependency
  if (!usageAnalysis.packageImported) {
    return {
      actualRisk: 'low',
      riskExplanation: `${packageName} is not imported in your source code but is installed. ` +
        `Consider removing it if unused, or update if it's a transitive dependency.`
    };
  }

  // If we have function-level data
  if (usageAnalysis.dataAvailable) {
    if (usageAnalysis.allUsageVulnerable) {
      return {
        actualRisk: 'high',
        riskExplanation: `All usage of ${packageName} is potentially vulnerable. ` +
          `Found ${usageAnalysis.importLocations.length} import(s) in your codebase. ` +
          (usageAnalysis.note || '')
      };
    }

    if (usageAnalysis.vulnerableFunctionUsed) {
      const funcs = [...new Set(usageAnalysis.locations.map(l => l.function))].join(', ');
      return {
        actualRisk: 'high',
        riskExplanation: `VULNERABLE: Found ${usageAnalysis.matchesFound} usage(s) of vulnerable function(s): ${funcs}. ` +
          `Your code directly calls the affected functions.`
      };
    }

    // Package is imported but vulnerable functions not used
    return {
      actualRisk: 'low',
      riskExplanation: `${packageName} is imported but you don't use the vulnerable function(s). ` +
        `Searched ${usageAnalysis.searchPatterns.length} patterns across your codebase. ` +
        `Exploitation is not possible with your current code.`
    };
  }

  // No function-level data available
  return {
    actualRisk: 'medium',
    riskExplanation: `${packageName} is imported but we don't have function-level vulnerability data. ` +
      `Treat as potentially vulnerable until you can verify your usage.`
  };
}

/**
 * Build fix information
 */
function buildFixInfo(vuln, packageName, installedVersion, vulnFuncInfo) {
  const fixedIn = vulnFuncInfo?.fixedIn || vuln.patched_versions || vuln.fixedIn;

  // Check if major version change
  let breakingChanges = 'unknown';
  if (installedVersion && fixedIn) {
    const currentMajor = parseInt(installedVersion.split('.')[0], 10);
    const fixedMajor = parseInt(fixedIn.split('.')[0], 10);
    breakingChanges = fixedMajor > currentMajor;
  }

  const isDeprecated = vulnFuncInfo?.deprecated === true;

  return {
    available: !!fixedIn && !isDeprecated,
    fixedIn: fixedIn || 'unknown',
    breakingChanges,
    command: fixedIn
      ? `npm install ${packageName}@${fixedIn}`
      : `npm update ${packageName}`,
    alternativeCommand: 'npm audit fix',
    effort: breakingChanges === true ? 'medium' : 'low',
    testingRequired: breakingChanges === true
      ? 'Full regression testing recommended due to major version change'
      : 'Basic smoke test recommended',
    deprecated: isDeprecated,
    deprecationNote: isDeprecated
      ? 'This package is deprecated. Consider migrating to an alternative.'
      : null
  };
}

/**
 * Build security recommendation with full context
 */
function buildSecurityRecommendation(vuln, packageName, installedVersion, actualRisk, usageAnalysis, fixInfo) {
  const parts = [];

  // Describe the actual situation
  if (actualRisk === 'high') {
    if (usageAnalysis.allUsageVulnerable) {
      parts.push(`VULNERABLE: You're using ${packageName}@${installedVersion} and all usage is potentially affected.`);
    } else {
      parts.push(`VULNERABLE: You're using ${packageName}@${installedVersion} and calling the affected function(s).`);
      parts.push(`Found ${usageAnalysis.matchesFound} vulnerable usage(s) in your codebase.`);
    }
    parts.push('Update immediately.');
  } else if (actualRisk === 'medium') {
    parts.push(`POTENTIALLY VULNERABLE: You're using ${packageName}@${installedVersion}.`);
    parts.push('Unable to confirm if vulnerable code paths are used.');
    parts.push('Update as a precaution.');
  } else if (actualRisk === 'none') {
    parts.push(`NO DIRECT RISK: ${packageName} is not imported in your code.`);
    parts.push('It may be a transitive dependency.');
    parts.push('Update to clear audit flags if it appears in npm audit.');
  } else {
    parts.push(`LOW RISK: You have ${packageName}@${installedVersion} which has a known vulnerability.`);
    parts.push("However, you don't use the vulnerable function(s) anywhere in your codebase.");
    parts.push('Exploitation is not possible with your current code.');
  }

  // What to do about it
  if (actualRisk === 'low' || actualRisk === 'none') {
    parts.push('Update anyway to: (1) clear audit flags, (2) prevent future devs from using the vulnerable function, (3) stay current.');
  }

  // Fix info
  if (fixInfo.deprecated) {
    parts.push(`Note: ${packageName} is deprecated. Consider migrating to an alternative package.`);
  } else if (fixInfo.breakingChanges === true) {
    parts.push(`Note: Fix requires major version upgrade (${installedVersion} → ${fixInfo.fixedIn}). Review changelog for breaking changes.`);
  }

  // Priority
  const priority = actualRisk === 'high'
    ? (vuln.severity === 'critical' ? 'critical' : 'high')
    : actualRisk === 'medium' ? 'medium' : 'low';

  const effort = actualRisk === 'high' && vuln.severity === 'critical'
    ? 'Drop everything'
    : actualRisk === 'high' ? 'Prioritise this sprint'
    : 'Schedule when convenient';

  parts.push(`Priority: ${effort}.`);

  return {
    action: fixInfo.deprecated ? 'migrate' : 'update',
    priority,
    confidence: usageAnalysis.dataAvailable ? 'high' : 'medium',
    command: fixInfo.command,
    reasoning: parts.join(' ')
  };
}

/**
 * Try to find matching CVE info even if exact CVE ID doesn't match
 */
function findMatchingCVE(packageName, cveId) {
  const packageInfo = vulnerableFunctionsDB[packageName];
  if (!packageInfo) return null;

  // Try exact match first
  if (packageInfo[cveId]) return packageInfo[cveId];

  // Try matching by CVE prefix (e.g., CVE-2021 might match CVE-2021-23337)
  const cveYear = cveId.match(/CVE-(\d{4})/)?.[1];
  if (cveYear) {
    for (const [key, value] of Object.entries(packageInfo)) {
      if (key.includes(`CVE-${cveYear}`)) {
        return value;
      }
    }
  }

  // Return first available (better than nothing)
  const keys = Object.keys(packageInfo);
  return keys.length > 0 ? packageInfo[keys[0]] : null;
}

/**
 * Build references array
 */
function buildReferences(vuln, cveId) {
  const refs = new Set();

  // Add CVE reference
  if (cveId.startsWith('CVE-')) {
    refs.add(`https://nvd.nist.gov/vuln/detail/${cveId}`);
  }

  // Add GHSA reference
  if (cveId.startsWith('GHSA-')) {
    refs.add(`https://github.com/advisories/${cveId}`);
  }

  // Add any references from the vulnerability data
  if (vuln.url) refs.add(vuln.url);
  if (vuln.references) {
    for (const ref of vuln.references) {
      if (typeof ref === 'string') refs.add(ref);
    }
  }

  return Array.from(refs);
}

/**
 * Build security headline for summary
 */
function buildSecurityHeadline(summary) {
  if (summary.total === 0) {
    return 'No known vulnerabilities detected.';
  }

  if (summary.actuallyExploitable === 0) {
    const flags = summary.auditFlagsOnly + summary.noRisk;
    return `${summary.total} vulnerability(s) found, but none are exploitable in your codebase. ` +
           `Update to clear ${flags} audit flag(s).`;
  }

  const exploitable = summary.actuallyExploitable;
  const flags = summary.total - exploitable;

  if (flags > 0) {
    return `${exploitable} exploitable vulnerability(s) found requiring immediate action. ` +
           `${flags} additional audit flag(s).`;
  }

  return `${exploitable} exploitable vulnerability(s) found. Update immediately.`;
}

/**
 * Get installed version of a package
 */
function getInstalledVersion(packageName, projectPath) {
  try {
    const pkgPath = join(projectPath || process.cwd(), 'node_modules', packageName, 'package.json');
    const content = readFileSync(pkgPath, 'utf-8');
    return JSON.parse(content).version;
  } catch {
    return 'unknown';
  }
}

// Cache for npm view results
const versionCache = new Map();

// Counter for npm view calls - limit to avoid hanging
let npmViewCallCount = 0;
const MAX_NPM_VIEW_CALLS = 20;

/**
 * Get latest version with caching (async to allow heartbeat)
 */
async function getLatestVersionCached(packageName) {
  if (versionCache.has(packageName)) {
    return versionCache.get(packageName);
  }

  // Limit npm view calls to prevent hanging on large repos
  if (npmViewCallCount >= MAX_NPM_VIEW_CALLS) {
    versionCache.set(packageName, 'unknown');
    return 'unknown';
  }

  npmViewCallCount++;

  try {
    const { stdout } = await execAsync(`npm view ${packageName} version 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000 // Reduced from 10s to 5s
    });
    const version = stdout.trim();
    versionCache.set(packageName, version);
    return version;
  } catch {
    versionCache.set(packageName, 'unknown');
    return 'unknown';
  }
}

/**
 * Get severity score from severity string
 */
function getSeverityScore(severity) {
  const scores = { critical: 9.5, high: 7.5, medium: 5.0, low: 2.5 };
  return scores[severity] || 0;
}

/**
 * Extract CWE from vulnerability
 */
function extractCWE(vuln) {
  if (vuln.cwe) {
    return Array.isArray(vuln.cwe) ? vuln.cwe[0] : vuln.cwe;
  }

  if (Array.isArray(vuln.via)) {
    for (const v of vuln.via) {
      if (typeof v === 'object' && v.cwe) {
        return Array.isArray(v.cwe) ? v.cwe[0] : v.cwe;
      }
    }
  }

  return null;
}

/**
 * Get CWE title
 */
function getCWETitle(cweId) {
  if (!cweId) return null;

  const cweTitles = {
    'CWE-94': 'Code Injection',
    'CWE-79': 'Cross-site Scripting (XSS)',
    'CWE-78': 'OS Command Injection',
    'CWE-89': 'SQL Injection',
    'CWE-1321': 'Prototype Pollution',
    'CWE-400': 'Resource Exhaustion',
    'CWE-1333': 'ReDoS',
    'CWE-22': 'Path Traversal',
    'CWE-601': 'Open Redirect',
    'CWE-918': 'Server-Side Request Forgery (SSRF)',
    'CWE-287': 'Improper Authentication',
    'CWE-384': 'Session Fixation',
    'CWE-327': 'Broken Cryptography',
    'CWE-200': 'Information Exposure',
    'CWE-502': 'Deserialization of Untrusted Data'
  };

  return cweTitles[cweId] || null;
}

/**
 * Escape special regex characters
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Enrich a vulnerability (for backwards compatibility)
 */
export function enrichVulnerability(vuln, projectPath, jsAnalysis) {
  // Already enriched during scan - just return with any additional analysis
  return vuln;
}

export default { scanSecurityVulnerabilities, enrichVulnerability };
