// src/cli/commands/check.mjs
// Quality gate command - validates scan results against thresholds

import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { getRecentScans } from '../../storage/index.mjs';

// Exit codes
const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_ERROR = 2;

/**
 * Default thresholds (unlimited = no check)
 */
const DEFAULT_THRESHOLDS = {
  maxCriticalVulnerabilities: null,
  maxHighVulnerabilities: null,
  maxExploitableVulnerabilities: null,
  maxUnusedDeps: null,
  maxDeadCodePercent: null,
  maxDeadFiles: null,
  maxWasteMb: null,
  maxOutdatedMajor: null,
  maxOutdatedCritical: null,
  requireLicenseCompliance: false
};

/**
 * Load config from .swynx.json if present
 */
function loadConfig(projectPath) {
  const configPaths = [
    join(projectPath, '.swynx.json'),
    join(projectPath, 'swynx.json'),
    join(projectPath, '.swynxrc.json')
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf8');
        const config = JSON.parse(content);
        return config.ci || config;
      } catch (e) {
        // Invalid config, continue
      }
    }
  }

  return {};
}

/**
 * Load scan results from file or database
 */
async function loadScanResults(scanFile, projectPath) {
  // If explicit file provided, use it
  if (scanFile) {
    const filePath = resolve(scanFile);
    if (!existsSync(filePath)) {
      throw new Error(`Scan file not found: ${filePath}`);
    }
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  }

  // Otherwise, get latest scan from database
  const scans = await getRecentScans(projectPath, 1, { includeRaw: true });
  if (!scans || scans.length === 0) {
    throw new Error(`No scans found for project: ${projectPath}\nRun 'swynx scan ${projectPath} --ci' first.`);
  }

  const latestScan = scans[0];
  if (latestScan.raw_data) {
    return JSON.parse(latestScan.raw_data);
  }

  // Fallback to indexed fields
  return {
    summary: {
      wastePercent: latestScan.waste_percent,
      wasteSizeBytes: latestScan.waste_bytes,
      totalSizeBytes: latestScan.total_bytes
    },
    healthScore: {
      score: latestScan.health_score
    },
    security: {
      summary: {
        critical: latestScan.security_critical,
        high: latestScan.security_high,
        medium: latestScan.security_medium,
        low: latestScan.security_low
      }
    },
    scannedAt: latestScan.scanned_at,
    id: latestScan.id
  };
}

/**
 * Run a single check
 */
function runCheck(name, threshold, actual, comparator = 'max') {
  if (threshold === null || threshold === undefined) {
    return null; // Skip check
  }

  let passed;
  let message;

  if (comparator === 'max') {
    passed = actual <= threshold;
    message = passed
      ? `${formatCheckName(name)}: ${actual} (max: ${threshold})`
      : `${formatCheckName(name)}: ${actual} exceeds threshold (max: ${threshold})`;
  } else if (comparator === 'bool') {
    passed = actual === threshold;
    message = passed
      ? `${formatCheckName(name)}: compliant`
      : `${formatCheckName(name)}: non-compliant`;
  }

  return {
    name,
    threshold,
    actual,
    passed,
    message
  };
}

/**
 * Format check name for display
 */
function formatCheckName(name) {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .replace(/max /i, '')
    .trim();
}

/**
 * Extract metrics from scan results
 */
function extractMetrics(scanResults) {
  const security = scanResults.security || {};
  const securitySummary = security.summary || {};
  const findings = scanResults.findings || {};
  const dependencies = scanResults.dependencies || {};
  const deadCode = scanResults.deadCode || {};
  const outdated = scanResults.outdated || {};
  const licenses = scanResults.licenses || {};

  // Count critical vulnerabilities
  const criticalVulns = securitySummary.critical ||
    (findings.critical?.filter(f => f.type === 'security' || f.category === 'security')?.length) || 0;

  // Count high vulnerabilities
  const highVulns = securitySummary.high ||
    (findings.warning?.filter(f => f.type === 'security' || f.category === 'security')?.length) || 0;

  // Count exploitable vulnerabilities (those with known exploits)
  const exploitableVulns = security.vulnerabilities?.filter(v => v.exploitable || v.hasExploit)?.length || 0;

  // Unused dependencies
  const unusedDeps = dependencies.unused?.length ||
    findings.warning?.filter(f => f.type === 'unused-dependency')?.length || 0;

  // Dead code percentage
  const deadCodePercent = deadCode.percentage ||
    scanResults.summary?.deadCodePercent || 0;

  // Dead files count
  const deadFiles = deadCode.files?.filter(f => f.deadPercent === 100)?.length ||
    deadCode.fullyDeadFiles || 0;

  // Waste in MB
  const wasteMb = (scanResults.summary?.wasteSizeBytes || 0) / (1024 * 1024);

  // Outdated with major updates
  const outdatedMajor = outdated.packages?.filter(p => p.updateType === 'major')?.length ||
    outdated.major || 0;

  // Outdated with security fixes
  const outdatedCritical = outdated.packages?.filter(p => p.hasSecurityFix)?.length ||
    outdated.withSecurityFixes || 0;

  // License compliance (true if no problematic licenses)
  const problematicLicenses = licenses.issues?.filter(l =>
    l.type === 'copyleft' || l.type === 'gpl' || l.risk === 'high'
  ) || [];
  const licenseCompliant = problematicLicenses.length === 0;

  return {
    criticalVulnerabilities: criticalVulns,
    highVulnerabilities: highVulns,
    exploitableVulnerabilities: exploitableVulns,
    unusedDeps,
    deadCodePercent,
    deadFiles,
    wasteMb: Math.round(wasteMb * 100) / 100,
    outdatedMajor,
    outdatedCritical,
    licenseCompliant
  };
}

/**
 * Main check command
 */
export async function checkCommand(options) {
  const projectPath = options.project || process.cwd();

  try {
    // Load config and merge with CLI options
    const fileConfig = loadConfig(projectPath);
    const thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...fileConfig
    };

    // CLI options override config file
    if (options.maxCriticalVulnerabilities !== undefined) {
      thresholds.maxCriticalVulnerabilities = parseInt(options.maxCriticalVulnerabilities, 10);
    }
    if (options.maxHighVulnerabilities !== undefined) {
      thresholds.maxHighVulnerabilities = parseInt(options.maxHighVulnerabilities, 10);
    }
    if (options.maxExploitableVulnerabilities !== undefined) {
      thresholds.maxExploitableVulnerabilities = parseInt(options.maxExploitableVulnerabilities, 10);
    }
    if (options.maxUnusedDeps !== undefined) {
      thresholds.maxUnusedDeps = parseInt(options.maxUnusedDeps, 10);
    }
    if (options.maxDeadCodePercent !== undefined) {
      thresholds.maxDeadCodePercent = parseFloat(options.maxDeadCodePercent);
    }
    if (options.maxDeadFiles !== undefined) {
      thresholds.maxDeadFiles = parseInt(options.maxDeadFiles, 10);
    }
    if (options.maxWasteMb !== undefined) {
      thresholds.maxWasteMb = parseFloat(options.maxWasteMb);
    }
    if (options.maxOutdatedMajor !== undefined) {
      thresholds.maxOutdatedMajor = parseInt(options.maxOutdatedMajor, 10);
    }
    if (options.maxOutdatedCritical !== undefined) {
      thresholds.maxOutdatedCritical = parseInt(options.maxOutdatedCritical, 10);
    }
    if (options.requireLicenseCompliance) {
      thresholds.requireLicenseCompliance = true;
    }

    // Load scan results
    const scanResults = await loadScanResults(options.scanFile, projectPath);
    const metrics = extractMetrics(scanResults);

    // Run checks
    const checks = [];

    const addCheck = (result) => {
      if (result) checks.push(result);
    };

    addCheck(runCheck('maxCriticalVulnerabilities', thresholds.maxCriticalVulnerabilities, metrics.criticalVulnerabilities));
    addCheck(runCheck('maxHighVulnerabilities', thresholds.maxHighVulnerabilities, metrics.highVulnerabilities));
    addCheck(runCheck('maxExploitableVulnerabilities', thresholds.maxExploitableVulnerabilities, metrics.exploitableVulnerabilities));
    addCheck(runCheck('maxUnusedDeps', thresholds.maxUnusedDeps, metrics.unusedDeps));
    addCheck(runCheck('maxDeadCodePercent', thresholds.maxDeadCodePercent, metrics.deadCodePercent));
    addCheck(runCheck('maxDeadFiles', thresholds.maxDeadFiles, metrics.deadFiles));
    addCheck(runCheck('maxWasteMb', thresholds.maxWasteMb, metrics.wasteMb));
    addCheck(runCheck('maxOutdatedMajor', thresholds.maxOutdatedMajor, metrics.outdatedMajor));
    addCheck(runCheck('maxOutdatedCritical', thresholds.maxOutdatedCritical, metrics.outdatedCritical));

    if (thresholds.requireLicenseCompliance) {
      addCheck(runCheck('licenseCompliance', true, metrics.licenseCompliant, 'bool'));
    }

    // Calculate results
    const passedChecks = checks.filter(c => c.passed);
    const failedChecks = checks.filter(c => !c.passed);
    const allPassed = failedChecks.length === 0;

    const result = {
      passed: allPassed,
      checks,
      summary: checks.length > 0
        ? `${failedChecks.length} of ${checks.length} checks failed`
        : 'No checks configured',
      scanId: scanResults.id || null,
      timestamp: new Date().toISOString()
    };

    // Output
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (!options.quiet || !allPassed) {
      outputConsole(result, options.quiet);
    }

    // Exit
    process.exit(allPassed ? EXIT_PASS : EXIT_FAIL);

  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({
        passed: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }, null, 2));
    } else {
      console.error(`\n Error: ${error.message}\n`);
    }
    process.exit(EXIT_ERROR);
  }
}

/**
 * Console output formatter
 */
function outputConsole(result, quiet) {
  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const yellow = '\x1b[33m';
  const reset = '\x1b[0m';
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';

  if (quiet) {
    // Quiet mode - only show failures
    console.log(`\n${red}${bold} Quality Gate Failed${reset}\n`);
    for (const check of result.checks.filter(c => !c.passed)) {
      console.log(`  ${red}✗${reset} ${check.message}`);
    }
    console.log('');
    return;
  }

  console.log('');
  console.log(`${bold} Swynx Quality Gate${reset}`);
  console.log(' ─────────────────────────────────────');
  console.log('');

  if (result.checks.length === 0) {
    console.log(`  ${yellow}⚠${reset} No checks configured`);
    console.log(`  ${dim}Use --max-critical-vulnerabilities, --max-dead-code-percent, etc.${reset}`);
    console.log('');
    return;
  }

  for (const check of result.checks) {
    const icon = check.passed ? `${green}✓${reset}` : `${red}✗${reset}`;
    console.log(`  ${icon} ${check.message}`);
  }

  console.log('');

  if (result.passed) {
    console.log(`  ${green}${bold}All checks passed${reset}`);
  } else {
    const failed = result.checks.filter(c => !c.passed).length;
    console.log(`  ${red}${bold}${failed} check${failed > 1 ? 's' : ''} failed${reset}`);
  }

  console.log('');
}

export default checkCommand;
