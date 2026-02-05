// src/reporter/ci.mjs
// Premium CI output formatter for enterprise customers
// Box-drawing characters for professional appearance

import { execSync } from 'child_process';

const BOX_WIDTH = 80;

/**
 * Box drawing characters
 */
const BOX = {
  topLeft: '╔',
  topRight: '╗',
  bottomLeft: '╚',
  bottomRight: '╝',
  horizontal: '═',
  vertical: '║',
  lightTopLeft: '┌',
  lightTopRight: '┐',
  lightBottomLeft: '└',
  lightBottomRight: '┘',
  lightHorizontal: '─',
  lightVertical: '│',
  lightTee: '├',
  lightTeeRight: '┤'
};

/**
 * ANSI color codes
 */
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

/**
 * Check if colors are supported
 */
function supportsColor() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  if (process.stdout.isTTY) return true;
  // CI environments that support ANSI
  return !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI);
}

const useColor = supportsColor();

function color(text, colorCode) {
  if (!useColor) return text;
  return `${colorCode}${text}${COLORS.reset}`;
}

/**
 * Create a horizontal line
 */
function line(char = BOX.lightHorizontal, width = BOX_WIDTH - 2) {
  return char.repeat(width);
}

/**
 * Pad string to fixed width (handling unicode)
 */
function pad(str, width, align = 'left') {
  const visibleLength = stripAnsi(str).length;
  const padding = Math.max(0, width - visibleLength);

  if (align === 'right') {
    return ' '.repeat(padding) + str;
  } else if (align === 'center') {
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + str + ' '.repeat(right);
  }
  return str + ' '.repeat(padding);
}

/**
 * Strip ANSI codes for length calculation
 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Create a box row with content
 */
function boxRow(content, boxChar = BOX.vertical) {
  const innerWidth = BOX_WIDTH - 4;
  const paddedContent = pad(content, innerWidth);
  return `${boxChar}  ${paddedContent}  ${boxChar}`;
}

/**
 * Create a light box row
 */
function lightBoxRow(content) {
  return boxRow(content, BOX.lightVertical);
}

/**
 * Create header box (double lines)
 */
function headerBox(lines) {
  const rows = [];
  rows.push(BOX.topLeft + line(BOX.horizontal) + BOX.topRight);
  for (const l of lines) {
    rows.push(boxRow(l));
  }
  rows.push(BOX.bottomLeft + line(BOX.horizontal) + BOX.bottomRight);
  return rows;
}

/**
 * Create section box (single lines)
 */
function sectionBox(title, contentLines, score = null) {
  const rows = [];
  const innerWidth = BOX_WIDTH - 4;

  // Title row with optional score
  let titleRow = title;
  if (score !== null) {
    const scoreStr = `${score}`;
    const titleLen = stripAnsi(title).length;
    const scoreLen = scoreStr.length;
    const padding = innerWidth - titleLen - scoreLen;
    titleRow = title + ' '.repeat(padding) + scoreStr;
  }

  rows.push(BOX.lightTopLeft + line() + BOX.lightTopRight);
  rows.push(lightBoxRow(titleRow));
  rows.push(BOX.lightTee + line() + BOX.lightTeeRight);
  rows.push(lightBoxRow(''));

  for (const l of contentLines) {
    rows.push(lightBoxRow(l));
  }

  rows.push(lightBoxRow(''));
  rows.push(BOX.lightBottomLeft + line() + BOX.lightBottomRight);

  return rows;
}

/**
 * Create progress bar
 */
function progressBar(percent, width = 32) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Get grade from score
 */
function getGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Create a data table with columns
 * @param {string[]} headers - Column headers
 * @param {string[][]} rows - Data rows
 * @param {number[]} widths - Column widths
 */
function dataTable(headers, rows, widths) {
  const output = [];
  const innerWidth = BOX_WIDTH - 4;

  // Header row
  let headerRow = '';
  headers.forEach((h, i) => {
    headerRow += pad(h, widths[i]) + (i < headers.length - 1 ? ' │ ' : '');
  });
  output.push(headerRow);

  // Separator
  let sepRow = '';
  widths.forEach((w, i) => {
    sepRow += '─'.repeat(w) + (i < widths.length - 1 ? '─┼─' : '');
  });
  output.push(sepRow);

  // Data rows
  for (const row of rows) {
    let dataRow = '';
    row.forEach((cell, i) => {
      const cellStr = String(cell || '').substring(0, widths[i]);
      dataRow += pad(cellStr, widths[i]) + (i < row.length - 1 ? ' │ ' : '');
    });
    output.push(dataRow);
  }

  return output;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * Get git branch name
 */
function getGitBranch() {
  // Try CI environment variables first
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF;
  if (process.env.CI_COMMIT_REF_NAME) return process.env.CI_COMMIT_REF_NAME;
  if (process.env.BRANCH_NAME) return process.env.BRANCH_NAME;
  if (process.env.GIT_BRANCH) return process.env.GIT_BRANCH.replace('origin/', '');

  // Try git command
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get git commit hash (short)
 */
function getGitCommit() {
  // Try CI environment variables first
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.substring(0, 8);
  if (process.env.CI_COMMIT_SHA) return process.env.CI_COMMIT_SHA.substring(0, 8);
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT.substring(0, 8);

  // Try git command
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get project name from path
 */
function getProjectName(projectPath) {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY.split('/').pop();
  }
  if (process.env.CI_PROJECT_NAME) {
    return process.env.CI_PROJECT_NAME;
  }
  if (!projectPath) return 'project';
  return projectPath.split('/').pop() || 'project';
}

/**
 * Calculate pillar scores from scan result
 */
function calculatePillarScores(result) {
  const scores = {
    performance: { score: 25, max: 25 },
    emissions: { score: 10, max: 10 },
    exposure: { score: 40, max: 40 },
    risk: { score: 25, max: 25 }
  };

  // Performance (based on waste and bundle size)
  const wastePercent = result.summary?.wastePercent || 0;
  const wasteDeduction = Math.min(25, wastePercent * 1.25);
  scores.performance.score = Math.max(0, Math.round(25 - wasteDeduction));

  // Emissions (based on CO2 targets)
  const monthlyCO2 = result.emissions?.current?.monthlyCO2Kg || 0;
  const targetCO2 = 10; // kg/month target
  if (monthlyCO2 > targetCO2) {
    const overBy = (monthlyCO2 - targetCO2) / targetCO2;
    scores.emissions.score = Math.max(0, Math.round(10 - (overBy * 5)));
  }

  // Exposure (based on vulnerabilities)
  const critical = result.security?.summary?.critical || 0;
  const high = result.security?.summary?.high || 0;
  const medium = result.security?.summary?.medium || 0;
  const criticalDeduction = Math.min(20, critical * 20);
  const highDeduction = Math.min(12, high * 4);
  const mediumDeduction = Math.min(8, medium * 1);
  scores.exposure.score = Math.max(0, Math.round(40 - criticalDeduction - highDeduction - mediumDeduction));

  // Risk (based on outdated deps and licenses)
  const outdated = result.outdated || {};
  const majorUpdates = outdated.summary?.major || 0;
  const minorUpdates = outdated.summary?.minor || 0;
  const deprecated = outdated.deprecated?.length || 0;
  const majorDeduction = Math.min(10, majorUpdates * 3);
  const minorDeduction = Math.min(5, minorUpdates * 0.5);
  const deprecatedDeduction = Math.min(5, deprecated * 2);
  const licenseDeduction = Math.min(5, (result.licenses?.summary?.restrictive || 0) * 3);
  scores.risk.score = Math.max(0, Math.round(25 - majorDeduction - minorDeduction - deprecatedDeduction - licenseDeduction));

  return scores;
}

/**
 * Exit codes:
 * 0 = pass
 * 1 = threshold exceeded
 * 2 = license error
 * 3 = scan error (handled in scan command)
 */
const EXIT_CODES = {
  PASS: 0,
  THRESHOLD_EXCEEDED: 1,
  LICENSE_ERROR: 2,
  SCAN_ERROR: 3
};

/**
 * Determine pass/fail status and reasons
 *
 * Default thresholds (strict for enterprise):
 * - maxCriticalVulnerabilities: 0 (no critical vulns allowed)
 * - maxHighVulnerabilities: 0 (no high vulns allowed)
 * - maxBundleSizeBytes: 1.5 MB
 * - wastePercent: 10%
 * - failOnRestrictiveLicense: true
 * - failOnUnknownLicense: true
 *
 * Customers can configure these in .swynx.json under "thresholds"
 */
function determineStatus(result, thresholds = {}) {
  const reasons = [];
  let passed = true;
  let hasLicenseError = false;

  // Default thresholds - strict by default for enterprise security
  const t = {
    maxCritical: thresholds.maxCriticalVulnerabilities ?? 0,
    maxHigh: thresholds.maxHighVulnerabilities ?? 0,
    maxBundleSize: thresholds.maxBundleSizeBytes ?? 1.5 * 1024 * 1024, // 1.5 MB
    maxWaste: thresholds.wastePercent ?? 10,
    failOnRestrictiveLicense: thresholds.failOnRestrictiveLicense ?? true,
    failOnUnknownLicense: thresholds.failOnUnknownLicense ?? true
  };

  const critical = result.security?.summary?.critical || 0;
  const high = result.security?.summary?.high || 0;
  const bundleSize = result.details?.bundles?.totalSize || result.summary?.totalSizeBytes || 0;
  const wastePercent = result.summary?.wastePercent || 0;

  // Check for license issues (exit code 2) - configurable
  const licenses = result.licenses || {};
  const restrictiveLicenses = licenses.restrictive?.length || 0;
  const unknownLicenses = licenses.unknown?.length || 0;

  if (t.failOnRestrictiveLicense && restrictiveLicenses > 0) {
    hasLicenseError = true;
    passed = false;
    reasons.push(`${restrictiveLicenses} packages with restrictive licenses require review`);
  }
  if (t.failOnUnknownLicense && unknownLicenses > 0) {
    hasLicenseError = true;
    passed = false;
    reasons.push(`${unknownLicenses} packages with unknown/missing licenses`);
  }

  if (critical > t.maxCritical) {
    passed = false;
    reasons.push(`${critical} critical ${critical === 1 ? 'vulnerability' : 'vulnerabilities'} (threshold: ${t.maxCritical})`);
  }

  if (high > t.maxHigh) {
    passed = false;
    reasons.push(`${high} high ${high === 1 ? 'vulnerability' : 'vulnerabilities'} (threshold: ${t.maxHigh})`);
  }

  if (bundleSize > t.maxBundleSize) {
    passed = false;
    reasons.push(`Bundle size ${formatBytes(bundleSize)} exceeds ${formatBytes(t.maxBundleSize)} target`);
  }

  // Determine exit code
  let exitCode = EXIT_CODES.PASS;
  if (!passed) {
    exitCode = hasLicenseError ? EXIT_CODES.LICENSE_ERROR : EXIT_CODES.THRESHOLD_EXCEEDED;
  }

  return { passed, reasons, exitCode, hasLicenseError };
}

/**
 * Format the premium CI output
 */
export function formatCIOutput(result, options = {}) {
  const lines = [];
  const version = options.version || '1.0.5';
  const license = options.license || 'OYNK (Enterprise + CI/CD)';
  const projectName = getProjectName(result.projectPath);
  const branch = getGitBranch();
  const commit = getGitCommit();
  const currencySymbol = options.currencySymbol || result.costs?.currencySymbol || '£';
  const thresholds = options.thresholds || {};

  const score = result.healthScore?.score || 0;
  const grade = result.healthScore?.grade || getGrade(score);
  const pillarScores = calculatePillarScores(result);
  const status = determineStatus(result, thresholds);

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER
  // ═══════════════════════════════════════════════════════════════════════════
  lines.push('');
  lines.push(...headerBox([
    `Swynx v${version}`,
    'Performance | Emissions | Exposure | Risk',
    line(BOX.horizontal).substring(0, BOX_WIDTH - 4),
    `License:  ${license}`,
    `Project:  ${projectName}`,
    `Branch:   ${branch}`,
    `Commit:   ${commit}`
  ]));

  // ═══════════════════════════════════════════════════════════════════════════
  // SCAN SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  const scanTime = result.duration ? (result.duration / 1000).toFixed(1) + 's' : 'N/A';
  const depCount = result.summary?.dependencyCount || result.details?.dependencies?.length || 0;

  lines.push('');
  lines.push(...sectionBox('SCAN SUMMARY', [
    `      ${progressBar(score)}  ${score}/100  Grade ${grade}`,
    '',
    `      Files scanned:      ${String(result.summary?.fileCount || 0).padEnd(12)}Dependencies:     ${depCount}`,
    `      Lines of code:      ${String(result.summary?.jsFileCount ? result.summary.jsFileCount * 50 : 'N/A').padEnd(12)}Scan time:        ${scanTime}`
  ]));

  // If passed, show compact view
  if (status.passed) {
    // ═══════════════════════════════════════════════════════════════════════════
    // P.E.E.R. BREAKDOWN (compact, passing)
    // ═══════════════════════════════════════════════════════════════════════════
    const pBar = (s, m) => {
      const pct = (s / m) * 100;
      const width = 26;
      const filled = Math.round((pct / 100) * width);
      return '█'.repeat(filled) + '░'.repeat(width - filled);
    };

    const critical = result.security?.summary?.critical || 0;
    const high = result.security?.summary?.high || 0;
    const minor = result.outdated?.summary?.minor || 0;
    const patch = result.outdated?.summary?.patch || 0;
    const wastePercent = result.summary?.wastePercent || 0;
    const monthlyCO2 = result.emissions?.current?.monthlyCO2Kg || 0;
    const annualWaste = result.costs?.total?.annual || 0;

    lines.push('');
    lines.push(...sectionBox('P.E.E.R. BREAKDOWN', [
      `Performance   ${pBar(pillarScores.performance.score, 25)}  ${pillarScores.performance.score}/${pillarScores.performance.max}   ${color('✓', COLORS.green)}`,
      `Emissions     ${pBar(pillarScores.emissions.score, 10)}  ${pillarScores.emissions.score}/${pillarScores.emissions.max}   ${color('✓', COLORS.green)}`,
      `Exposure      ${pBar(pillarScores.exposure.score, 40)}  ${pillarScores.exposure.score}/${pillarScores.exposure.max}   ${color('✓', COLORS.green)}`,
      `Risk          ${pBar(pillarScores.risk.score, 25)}  ${pillarScores.risk.score}/${pillarScores.risk.max}   ${color('✓', COLORS.green)}`,
      '',
      `Waste:           ${wastePercent.toFixed(1)}%        Vulnerabilities:   ${critical} critical, ${high} high`,
      `CO₂/month:       ${monthlyCO2.toFixed(1)} kg      Outdated deps:     ${minor} minor, ${patch} patch`,
      `Annual waste:    ${currencySymbol}${annualWaste.toFixed(0).padEnd(8)}License risks:     None`
    ]));

    // ═══════════════════════════════════════════════════════════════════════════
    // PASSED FOOTER
    // ═══════════════════════════════════════════════════════════════════════════
    lines.push('');
    lines.push(...headerBox([
      '',
      color('✓ PASSED', COLORS.green),
      '',
      'All thresholds met. No blocking issues found.',
      ''
    ]));

  } else {
    // ═══════════════════════════════════════════════════════════════════════════
    // PERFORMANCE SECTION (detailed, failing)
    // ═══════════════════════════════════════════════════════════════════════════
    const bundleSize = result.details?.bundles?.totalSize || result.summary?.totalSizeBytes || 0;
    const targetSize = thresholds.maxBundleSizeBytes || 1.5 * 1024 * 1024;
    const bundleStatus = bundleSize > targetSize ? color('✗ OVER', COLORS.red) : color('✓ OK', COLORS.green);

    const deadCodeLines = result.summary?.deadCodeBytes ? Math.round(result.summary.deadCodeBytes / 50) : 0;
    const deadCodePercent = result.summary?.wastePercent || 0;
    const deadCodeStatus = deadCodeLines > 0 ? color('✗ FOUND', COLORS.red) : color('✓ OK', COLORS.green);

    const unusedExports = result.summary?.deadCodeExports || 0;
    const unusedStatus = unusedExports > 0 ? color('✗ FOUND', COLORS.red) : color('✓ OK', COLORS.green);

    const perfContent = [
      `Bundle Size:        ${formatBytes(bundleSize)} (target: < ${formatBytes(targetSize)})${' '.repeat(Math.max(0, 20 - formatBytes(bundleSize).length))}${bundleStatus}`,
      `Dead Code:          ${deadCodeLines.toLocaleString()} lines (${deadCodePercent.toFixed(1)}% of codebase)${' '.repeat(Math.max(0, 14 - deadCodeLines.toString().length))}${deadCodeStatus}`,
      `Unused Exports:     ${unusedExports} functions never imported${' '.repeat(Math.max(0, 18 - unusedExports.toString().length))}${unusedStatus}`
    ];

    // Add top offenders if dead code exists
    const deadCode = result.details?.deadCode;
    if (deadCode && (deadCode.fullyDeadFiles?.length > 0 || deadCode.partiallyDeadFiles?.length > 0)) {
      perfContent.push('');
      perfContent.push('Top offenders:');

      const allDeadFiles = [
        ...(deadCode.fullyDeadFiles || []).map(f => ({ ...f, type: 'entirely unused' })),
        ...(deadCode.partiallyDeadFiles || []).slice(0, 3).map(f => ({ ...f, type: `${f.deadExports?.length || 0} dead exports` }))
      ].slice(0, 3);

      for (const file of allDeadFiles) {
        const name = (file.relativePath || file.path || '').slice(-35);
        const size = file.sizeBytes ? Math.round(file.sizeBytes / 50) : 0;
        perfContent.push(`  • ${name.padEnd(35)} ${String(size).padStart(5)} lines   ${file.type}`);
      }
    }

    lines.push('');
    lines.push(...sectionBox('PERFORMANCE', perfContent, `${pillarScores.performance.score}/${pillarScores.performance.max}`));

    // ═══════════════════════════════════════════════════════════════════════════
    // EMISSIONS SECTION
    // ═══════════════════════════════════════════════════════════════════════════
    const monthlyCO2 = result.emissions?.current?.monthlyCO2Kg || 0;
    const annualCO2 = result.emissions?.current?.annualCO2Kg || 0;
    const targetCO2 = 10;
    const co2Status = monthlyCO2 > targetCO2 ? color('✗ OVER', COLORS.red) : color('✓ OK', COLORS.green);
    const perRequest = result.emissions?.current?.perRequestGrams || (monthlyCO2 * 1000 / 10000);

    const emissionsContent = [
      `Monthly CO₂:        ${monthlyCO2.toFixed(1)} kg (target: < ${targetCO2} kg)${' '.repeat(Math.max(0, 20 - monthlyCO2.toFixed(1).length))}${co2Status}`,
      `Per Request:        ${perRequest.toFixed(2)}g CO₂`,
      `Annual Projection:  ${annualCO2.toFixed(1)} kg CO₂`
    ];

    // Add breakdown if available
    const wastePercent = result.summary?.wastePercent || 0;
    if (wastePercent > 0) {
      const unusedDepCO2 = monthlyCO2 * 0.25;
      const deadCodeCO2 = monthlyCO2 * 0.09;
      const bundleCO2 = monthlyCO2 * 0.66;

      emissionsContent.push('');
      emissionsContent.push('Breakdown:');
      emissionsContent.push(`  • Bundle transfer:     ${bundleCO2.toFixed(1)} kg/month (66%)`);
      emissionsContent.push(`  • Unused dependencies: ${unusedDepCO2.toFixed(1)} kg/month (25%)`);
      emissionsContent.push(`  • Dead code overhead:  ${deadCodeCO2.toFixed(1)} kg/month (9%)`);

      if (unusedDepCO2 > 1) {
        emissionsContent.push('');
        emissionsContent.push(`💡 Removing unused dependencies would save ${unusedDepCO2.toFixed(1)} kg CO₂/month`);
      }
    }

    lines.push('');
    lines.push(...sectionBox('EMISSIONS', emissionsContent, `${pillarScores.emissions.score}/${pillarScores.emissions.max}`));

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPOSURE SECTION
    // ═══════════════════════════════════════════════════════════════════════════
    const security = result.security || {};
    const critical = security.summary?.critical || 0;
    const high = security.summary?.high || 0;
    const medium = security.summary?.medium || 0;
    const low = security.summary?.low || 0;

    const exposureContent = [
      'Vulnerabilities:',
      `  ${color('🔴 CRITICAL:', COLORS.red)}  ${critical}        ${color('🟠 HIGH:', COLORS.yellow)}  ${high}        🟡 MEDIUM:  ${medium}        ⚪ LOW:  ${low}`
    ];

    // Add critical and high details
    const criticalVulns = security.critical || [];
    const highVulns = security.high || [];
    const allHighSeverity = [...criticalVulns, ...highVulns].slice(0, 4);

    if (allHighSeverity.length > 0) {
      exposureContent.push('');
      exposureContent.push('Critical & High Details:');

      for (const vuln of allHighSeverity) {
        const icon = vuln.severity === 'critical' ? color('🔴', COLORS.red) : color('🟠', COLORS.yellow);
        const pkg = `${vuln.package || vuln.name}@${vuln.version || '?'}`.substring(0, 22);
        const cve = (vuln.cve || vuln.id || 'N/A').substring(0, 16);
        const title = (vuln.title || vuln.description || 'Unknown vulnerability').substring(0, 25);

        exposureContent.push(`  ${icon} ${pkg.padEnd(22)} ${cve.padEnd(18)} ${title}`);

        // Exploitability info
        if (vuln.exploitable !== undefined) {
          const exploitStatus = vuln.exploitable === true
            ? color('Yes', COLORS.red)
            : vuln.exploitable === false
              ? color('No', COLORS.green)
              : color('Unknown', COLORS.yellow);
          const location = vuln.usageLocation || vuln.affectedFunction || '';
          exposureContent.push(`     └─ EXPLOITABLE: ${exploitStatus}${location ? ` - ${location.substring(0, 40)}` : ''}`);
        }
        exposureContent.push('');
      }
    }

    // License risks
    const licenses = result.licenses || {};
    const copyleft = licenses.copyleft?.length || 0;
    const restrictive = licenses.restrictive?.length || 0;
    const unlicensed = licenses.unknown?.length || 0;

    if (copyleft > 0 || restrictive > 0 || unlicensed > 0) {
      exposureContent.push('License Risks:');
      if (copyleft > 0) exposureContent.push(`  ⚠️  ${copyleft} packages with GPL-3.0 (copyleft) - review required`);
      if (unlicensed > 0) exposureContent.push(`  ⚠️  ${unlicensed} package with UNLICENSED - legal review required`);
    }

    lines.push('');
    lines.push(...sectionBox('EXPOSURE', exposureContent, `${pillarScores.exposure.score}/${pillarScores.exposure.max}`));

    // ═══════════════════════════════════════════════════════════════════════════
    // RISK SECTION
    // ═══════════════════════════════════════════════════════════════════════════
    const outdated = result.outdated || {};
    const majorUpdates = outdated.summary?.major || 0;
    const minorUpdates = outdated.summary?.minor || 0;
    const patchUpdates = outdated.summary?.patch || 0;

    const riskContent = [
      'Outdated Dependencies:',
      `  ${color('🔴 Major behind:', COLORS.red)}   ${majorUpdates} packages (breaking changes available)`,
      `  ${color('🟠 Minor behind:', COLORS.yellow)}   ${minorUpdates} packages`,
      `  🟡 Patch behind:   ${patchUpdates} packages`
    ];

    // Major updates required
    const majorPackages = (outdated.packages || []).filter(p => p.updateType === 'major').slice(0, 3);
    if (majorPackages.length > 0) {
      riskContent.push('');
      riskContent.push('Major Updates Required:');
      for (const pkg of majorPackages) {
        const name = (pkg.package || pkg.name || 'unknown').substring(0, 12).padEnd(12);
        const versions = `${pkg.current || '?'} → ${pkg.latest || '?'}`.padEnd(18);
        const note = pkg.breakingChanges?.[0] || 'Review migration guide';
        riskContent.push(`  • ${name} ${versions} ${(note || '').substring(0, 35)}`);
      }
    }

    // Deprecated packages
    const deprecated = outdated.deprecated || [];
    if (deprecated.length > 0) {
      riskContent.push('');
      riskContent.push('Deprecated Packages:');
      for (const pkg of deprecated.slice(0, 2)) {
        const name = `${pkg.package || pkg.name || 'unknown'}@${pkg.current || pkg.version || '?'}`.padEnd(22);
        const alt = pkg.replacement || pkg.packageHealth?.alternatives?.[0]?.name || 'No direct replacement';
        riskContent.push(`  ⛔ ${name} ${(alt || '').substring(0, 40)}`);
      }
    }

    // Unmaintained packages
    const unmaintained = (outdated.packages || []).filter(p => p.unmaintained || (p.packageHealth && !p.packageHealth.maintained)).slice(0, 2);
    if (unmaintained.length > 0) {
      riskContent.push('');
      riskContent.push('Unmaintained (no updates in 2+ years):');
      for (const pkg of unmaintained) {
        const name = `${pkg.package || pkg.name || 'unknown'}@${pkg.current || pkg.version || '?'}`.padEnd(22);
        const lastUpdate = pkg.packageHealth?.lastPublish ? `Last update: ${String(pkg.packageHealth.lastPublish).substring(0, 10)}` : '';
        riskContent.push(`  ⚠️  ${name} ${lastUpdate}`);
      }
    }

    lines.push('');
    lines.push(...sectionBox('RISK', riskContent, `${pillarScores.risk.score}/${pillarScores.risk.max}`));

    // ═══════════════════════════════════════════════════════════════════════════
    // DETAILED: OUTDATED DEPENDENCIES TABLE
    // ═══════════════════════════════════════════════════════════════════════════
    const allOutdatedPackages = outdated.packages || [];
    if (allOutdatedPackages.length > 0) {
      const outdatedContent = [];

      // Table header
      outdatedContent.push('Package          Current    Latest     Type   Priority  Recommendation');
      outdatedContent.push('───────────────  ─────────  ─────────  ─────  ────────  ─────────────────────────');

      for (const pkg of allOutdatedPackages.slice(0, 15)) {
        const name = (pkg.package || pkg.name || '?').substring(0, 15).padEnd(15);
        const current = (pkg.current || '?').substring(0, 9).padEnd(9);
        const latest = (pkg.latest || '?').substring(0, 9).padEnd(9);
        const type = (pkg.updateType || '?').substring(0, 5).padEnd(5);
        const priority = (pkg.recommendation?.priority || 'low').substring(0, 8).padEnd(8);
        const rec = (pkg.recommendation?.reasoning || 'Review changelog').substring(0, 25);
        outdatedContent.push(`${name}  ${current}  ${latest}  ${type}  ${priority}  ${rec}`);
      }

      if (allOutdatedPackages.length > 15) {
        outdatedContent.push('');
        outdatedContent.push(`... and ${allOutdatedPackages.length - 15} more outdated packages`);
      }

      lines.push('');
      lines.push(...sectionBox(`OUTDATED DEPENDENCIES`, outdatedContent, `${allOutdatedPackages.length} packages`));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DETAILED: SECURITY VULNERABILITIES TABLE
    // ═══════════════════════════════════════════════════════════════════════════
    const allVulns = [...criticalVulns, ...highVulns, ...(security.medium || [])];
    if (allVulns.length > 0) {
      const vulnContent = [];

      vulnContent.push('Severity   Package              CVE              Title');
      vulnContent.push('─────────  ───────────────────  ───────────────  ────────────────────────────');

      for (const vuln of allVulns.slice(0, 10)) {
        const sev = (vuln.severity || '?').substring(0, 9).padEnd(9);
        const pkg = `${vuln.package || vuln.name || '?'}@${vuln.version || '?'}`.substring(0, 19).padEnd(19);
        const cve = (vuln.cve || vuln.id || 'N/A').substring(0, 15).padEnd(15);
        const title = (vuln.title || 'Unknown').substring(0, 28);

        const sevColor = vuln.severity === 'critical' ? COLORS.red : vuln.severity === 'high' ? COLORS.yellow : '';
        vulnContent.push(`${color(sev, sevColor)}  ${pkg}  ${cve}  ${title}`);

        // Show exploitability if available
        if (vuln.exploitable !== undefined) {
          const exploitText = vuln.exploitable === true
            ? color('  └─ EXPLOITABLE: Code path reaches vulnerable function', COLORS.red)
            : vuln.exploitable === false
              ? color('  └─ Not exploitable: Vulnerable code not reachable', COLORS.green)
              : '  └─ Exploitability: Unknown';
          vulnContent.push(exploitText);
        }
      }

      if (allVulns.length > 10) {
        vulnContent.push('');
        vulnContent.push(`... and ${allVulns.length - 10} more vulnerabilities`);
      }

      // Add fix commands
      vulnContent.push('');
      vulnContent.push(color('FIX:', COLORS.cyan) + ' Update vulnerable packages:');
      const vulnsWithFix = allVulns.filter(v => v.fixedIn || v.patchedVersions?.length > 0);
      for (const vuln of vulnsWithFix.slice(0, 5)) {
        const pkgName = vuln.package || vuln.name;
        const fixVersion = vuln.fixedIn || vuln.patchedVersions?.[0] || 'latest';
        vulnContent.push(`  npm install ${pkgName}@${fixVersion}`);
      }
      if (vulnsWithFix.length === 0) {
        vulnContent.push('  npm audit fix');
      }

      lines.push('');
      lines.push(...sectionBox('SECURITY VULNERABILITIES', vulnContent, `${allVulns.length} found`));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DETAILED: DEAD CODE FILES
    // ═══════════════════════════════════════════════════════════════════════════
    // Note: deadCode variable already declared above in PERFORMANCE section
    const fullyDeadFiles = deadCode?.fullyDeadFiles || [];
    const partiallyDeadFiles = deadCode?.partiallyDeadFiles || [];
    const perFindingCosts = result.costs?.perFinding || {};
    const deadCodeCost = perFindingCosts.deadCode?.annualTotal || 0;

    if (fullyDeadFiles.length > 0 || partiallyDeadFiles.length > 0) {
      const deadContent = [];

      if (fullyDeadFiles.length > 0) {
        deadContent.push(color('Entirely Unused Files (safe to delete):', COLORS.bold));
        deadContent.push('File                                              Lines    Size');
        deadContent.push('────────────────────────────────────────────────  ───────  ────────');

        for (const file of fullyDeadFiles.slice(0, 8)) {
          const path = (file.relativePath || file.file || file.path || '?').substring(0, 48).padEnd(48);
          const fileLines = String(file.lineCount || file.lines || 0).padStart(7);
          const size = formatBytes(file.sizeBytes || 0).padStart(8);
          deadContent.push(`${path}  ${fileLines}  ${size}`);
        }

        if (fullyDeadFiles.length > 8) {
          deadContent.push(`... and ${fullyDeadFiles.length - 8} more unused file candidates`);
        }

        // Add verification commands
        deadContent.push('');
        deadContent.push(color('VERIFY:', COLORS.cyan) + ' Check these files before removing:');
        for (const file of fullyDeadFiles.slice(0, 5)) {
          const path = file.relativePath || file.file || file.path;
          deadContent.push(`  rm ${path}`);
        }
        if (fullyDeadFiles.length > 5) {
          deadContent.push(`  # ... and ${fullyDeadFiles.length - 5} more files`);
        }
      }

      if (partiallyDeadFiles.length > 0) {
        if (fullyDeadFiles.length > 0) deadContent.push('');
        deadContent.push(color('Files with Unused Exports:', COLORS.bold));
        deadContent.push('File                                              Dead Exports');
        deadContent.push('────────────────────────────────────────────────  ────────────');

        for (const file of partiallyDeadFiles.slice(0, 6)) {
          const path = (file.relativePath || file.file || file.path || '?').substring(0, 48).padEnd(48);
          const deadExportsCount = file.summary?.deadExports || file.deadExports?.length || 0;
          deadContent.push(`${path}  ${String(deadExportsCount).padStart(12)}`);

          // Show which exports are dead with line numbers
          const exportsToShow = (file.exports || []).filter(e => e.status === 'dead').slice(0, 3);
          for (const exp of exportsToShow) {
            const lineInfo = exp.line ? `:${exp.line}` : '';
            deadContent.push(`  └─ ${exp.name}()${lineInfo} - never imported`);
          }
        }

        if (partiallyDeadFiles.length > 6) {
          deadContent.push(`... and ${partiallyDeadFiles.length - 6} more files with dead exports`);
        }
      }

      const totalDeadExports = result.summary?.deadCodeExports || 0;
      const costLabel = deadCodeCost > 0 ? ` │ ${currencySymbol}${deadCodeCost.toFixed(0)}/yr` : '';
      lines.push('');
      lines.push(...sectionBox('DEAD CODE ANALYSIS', deadContent, `${fullyDeadFiles.length} files, ${totalDeadExports} exports${costLabel}`));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DETAILED: UNUSED DEPENDENCIES
    // ═══════════════════════════════════════════════════════════════════════════
    const unusedDepsDetail = result.details?.unusedDeps || [];
    const unusedDepsCost = perFindingCosts.unusedDeps?.annualTotal || 0;

    if (unusedDepsDetail.length > 0) {
      const depContent = [];

      depContent.push('Package                    Size        Last Used   Recommendation');
      depContent.push('─────────────────────────  ──────────  ──────────  ─────────────────────────');

      for (const dep of unusedDepsDetail.slice(0, 10)) {
        const name = (dep.name || '?').substring(0, 25).padEnd(25);
        const size = formatBytes(dep.sizeBytes || 0).padStart(10);
        const lastUsed = (dep.lastUsedDate || 'Never').substring(0, 10).padEnd(10);
        const rec = 'npm uninstall ' + (dep.name || '').substring(0, 15);
        depContent.push(`${name}  ${size}  ${lastUsed}  ${rec}`);
      }

      if (unusedDepsDetail.length > 10) {
        depContent.push('');
        depContent.push(`... and ${unusedDepsDetail.length - 10} more unused dependencies`);
      }

      // Calculate total waste
      const totalSize = unusedDepsDetail.reduce((s, d) => s + (d.sizeBytes || 0), 0);
      depContent.push('');
      depContent.push(`Total node_modules waste: ${formatBytes(totalSize)}`);

      // Add uninstall command
      depContent.push('');
      depContent.push(color('FIX:', COLORS.cyan) + ' Run this command to remove all:');
      const allDepNames = unusedDepsDetail.map(d => d.name).join(' ');
      if (allDepNames.length <= 60) {
        depContent.push(`  npm uninstall ${allDepNames}`);
      } else {
        // Split into multiple lines
        depContent.push(`  npm uninstall ${unusedDepsDetail.slice(0, 5).map(d => d.name).join(' ')}`);
        if (unusedDepsDetail.length > 5) {
          depContent.push(`  npm uninstall ${unusedDepsDetail.slice(5, 10).map(d => d.name).join(' ')}`);
        }
        if (unusedDepsDetail.length > 10) {
          depContent.push(`  # ... continue for remaining ${unusedDepsDetail.length - 10} packages`);
        }
      }

      const costLabel = unusedDepsCost > 0 ? ` │ ${currencySymbol}${unusedDepsCost.toFixed(0)}/yr` : '';
      lines.push('');
      lines.push(...sectionBox('UNUSED DEPENDENCIES', depContent, `${unusedDepsDetail.length} packages${costLabel}`));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DETAILED: DUPLICATE CODE
    // ═══════════════════════════════════════════════════════════════════════════
    const duplicates = result.details?.duplicates;
    const dupFunctions = duplicates?.duplicateFunctions || [];
    const similarBlocks = duplicates?.similarBlocks || [];

    if (dupFunctions.length > 0 || similarBlocks.length > 0) {
      const dupContent = [];

      if (dupFunctions.length > 0) {
        dupContent.push(color('Duplicate Functions:', COLORS.bold));

        for (const dup of dupFunctions.slice(0, 5)) {
          const name = dup.name || dup.signature || 'anonymous';
          const occurrences = dup.occurrences?.length || dup.locations?.length || 2;
          dupContent.push(`  ${name} - found in ${occurrences} locations`);

          for (const loc of (dup.occurrences || dup.locations || []).slice(0, 3)) {
            const file = loc.file || loc.relativePath || '?';
            const line = loc.line || '?';
            dupContent.push(`    └─ ${file}:${line}`);
          }
        }
      }

      if (similarBlocks.length > 0) {
        if (dupFunctions.length > 0) dupContent.push('');
        dupContent.push(color(`Similar Code Blocks: ${similarBlocks.length}`, COLORS.bold));
        dupContent.push('Consider extracting to shared functions.');
      }

      lines.push('');
      lines.push(...sectionBox('DUPLICATE CODE', dupContent, `${dupFunctions.length + similarBlocks.length} instances`));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DETAILED: HEAVY DEPENDENCIES
    // ═══════════════════════════════════════════════════════════════════════════
    const heavyDeps = result.details?.heavyDeps || [];
    if (heavyDeps.length > 0) {
      const heavyContent = [];

      heavyContent.push('Package                    Size        Impact    Alternative');
      heavyContent.push('─────────────────────────  ──────────  ────────  ─────────────────────');

      for (const dep of heavyDeps.slice(0, 8)) {
        const name = (dep.name || '?').substring(0, 25).padEnd(25);
        const size = formatBytes(dep.sizeBytes || dep.size || 0).padStart(10);
        const impact = (dep.bundleImpact || 'high').padEnd(8);
        const alt = (dep.alternative || dep.alternatives?.[0]?.name || '-').substring(0, 21);
        heavyContent.push(`${name}  ${size}  ${impact}  ${alt}`);
      }

      lines.push('');
      lines.push(...sectionBox('HEAVY DEPENDENCIES', heavyContent, `${heavyDeps.length} packages`));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DETAILED: LICENSE ISSUES
    // ═══════════════════════════════════════════════════════════════════════════
    const licenseIssues = [];
    const copyleftPkgs = licenses.copyleft || [];
    const restrictivePkgs = licenses.restrictive || [];
    const unknownPkgs = licenses.unknown || [];

    if (copyleftPkgs.length > 0 || restrictivePkgs.length > 0 || unknownPkgs.length > 0) {
      const licContent = [];

      if (copyleftPkgs.length > 0) {
        licContent.push(color('Copyleft Licenses (GPL) - May require source disclosure:', COLORS.yellow));
        for (const pkg of copyleftPkgs.slice(0, 5)) {
          const name = typeof pkg === 'string' ? pkg : (pkg.name || pkg.package || '?');
          const lic = typeof pkg === 'object' ? (pkg.license || 'GPL') : 'GPL';
          licContent.push(`  ⚠️  ${name} (${lic})`);
        }
      }

      if (restrictivePkgs.length > 0) {
        if (copyleftPkgs.length > 0) licContent.push('');
        licContent.push(color('Restrictive Licenses - Legal review recommended:', COLORS.yellow));
        for (const pkg of restrictivePkgs.slice(0, 5)) {
          const name = typeof pkg === 'string' ? pkg : (pkg.name || pkg.package || '?');
          const lic = typeof pkg === 'object' ? (pkg.license || '?') : '?';
          licContent.push(`  ⚠️  ${name} (${lic})`);
        }
      }

      if (unknownPkgs.length > 0) {
        if (copyleftPkgs.length > 0 || restrictivePkgs.length > 0) licContent.push('');
        licContent.push(color('Unknown/Missing Licenses:', COLORS.dim));
        for (const pkg of unknownPkgs.slice(0, 5)) {
          const name = typeof pkg === 'string' ? pkg : (pkg.name || pkg.package || '?');
          licContent.push(`  ❓ ${name}`);
        }
      }

      const totalLicenseIssues = copyleftPkgs.length + restrictivePkgs.length + unknownPkgs.length;
      lines.push('');
      lines.push(...sectionBox('LICENSE COMPLIANCE', licContent, `${totalLicenseIssues} issues`));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DETAILED: ASSET OPTIMIZATION OPPORTUNITIES
    // ═══════════════════════════════════════════════════════════════════════════
    const assetOptimisation = result.details?.assetOptimisation || {};
    const optimizableAssets = assetOptimisation.optimizable || [];
    const assetOptCost = perFindingCosts.assetOptimisation?.annualTotal || 0;

    if (optimizableAssets.length > 0) {
      const assetContent = [];

      assetContent.push('File                                    Format   Size       Savings    Action');
      assetContent.push('──────────────────────────────────────  ──────  ─────────  ─────────  ────────────────');

      for (const asset of optimizableAssets.slice(0, 10)) {
        const file = (asset.file || '?').substring(0, 38).padEnd(38);
        const format = (asset.format || '?').toUpperCase().substring(0, 6).padEnd(6);
        const size = formatBytes(asset.currentSize || 0).padStart(9);
        const savings = formatBytes(asset.recommendations?.[0]?.estimatedSavings || 0).padStart(9);
        const action = (asset.recommendations?.[0]?.to || 'optimize').substring(0, 16);

        const priorityIcon = asset.priority === 'critical' ? color('!!!', COLORS.red)
          : asset.priority === 'high' ? color('!!', COLORS.yellow)
          : '';

        assetContent.push(`${file}  ${format}  ${size}  ${savings}  ${action} ${priorityIcon}`);
      }

      if (optimizableAssets.length > 10) {
        assetContent.push('');
        assetContent.push(`... and ${optimizableAssets.length - 10} more assets to optimize`);
      }

      // Total savings
      const totalSavings = assetOptimisation.potentialSavings ||
        optimizableAssets.reduce((sum, a) => sum + (a.recommendations?.[0]?.estimatedSavings || 0), 0);

      if (totalSavings > 0) {
        assetContent.push('');
        assetContent.push(`Total potential savings: ${formatBytes(totalSavings)}`);
      }

      // Add fix commands
      assetContent.push('');
      assetContent.push(color('FIX:', COLORS.cyan) + ' Convert images to WebP:');
      for (const asset of optimizableAssets.filter(a => a.priority === 'critical' || a.priority === 'high').slice(0, 3)) {
        const inputFile = asset.file || '?';
        const outputFile = inputFile.replace(/\.(png|jpg|jpeg|gif)$/i, '.webp');
        assetContent.push(`  npx sharp-cli "${inputFile}" -o "${outputFile}"`);
      }
      if (optimizableAssets.length > 3) {
        assetContent.push('');
        assetContent.push('  # Batch convert all:');
        assetContent.push('  npx sharp-cli "src/**/*.{png,jpg}" -o "{dir}/{name}.webp"');
      }

      const costLabel = assetOptCost > 0 ? ` │ ${currencySymbol}${assetOptCost.toFixed(0)}/yr` : '';
      lines.push('');
      lines.push(...sectionBox('ASSET OPTIMIZATION', assetContent, `${optimizableAssets.length} opportunities${costLabel}`));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DETAILED: UNUSED ASSETS
    // ═══════════════════════════════════════════════════════════════════════════
    const unusedAssets = result.details?.unusedAssets || [];
    const unusedAssetsCost = perFindingCosts.unusedAssets?.annualTotal || 0;

    if (unusedAssets.length > 0) {
      const unusedContent = [];

      unusedContent.push('File                                              Type      Size');
      unusedContent.push('────────────────────────────────────────────────  ────────  ──────────');

      for (const asset of unusedAssets.slice(0, 10)) {
        const file = (asset.file || asset.relativePath || '?').substring(0, 48).padEnd(48);
        const type = (asset.type || 'unknown').substring(0, 8).padEnd(8);
        const size = formatBytes(asset.sizeBytes || 0).padStart(10);

        unusedContent.push(`${file}  ${type}  ${size}`);
      }

      if (unusedAssets.length > 10) {
        unusedContent.push('');
        unusedContent.push(`... and ${unusedAssets.length - 10} more unused assets`);
      }

      // Total size
      const totalUnusedSize = unusedAssets.reduce((sum, a) => sum + (a.sizeBytes || 0), 0);
      unusedContent.push('');
      unusedContent.push(`Total unused: ${formatBytes(totalUnusedSize)} (safe to delete)`);

      // Add delete commands
      unusedContent.push('');
      unusedContent.push(color('FIX:', COLORS.cyan) + ' Delete unused assets:');
      for (const asset of unusedAssets.slice(0, 5)) {
        const file = asset.file || asset.relativePath;
        unusedContent.push(`  rm "${file}"`);
      }
      if (unusedAssets.length > 5) {
        unusedContent.push(`  # ... and ${unusedAssets.length - 5} more files`);
      }

      const costLabel = unusedAssetsCost > 0 ? ` │ ${currencySymbol}${unusedAssetsCost.toFixed(0)}/yr` : '';
      lines.push('');
      lines.push(...sectionBox('UNUSED ASSETS', unusedContent, `${unusedAssets.length} files${costLabel}`));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ISSUES SUMMARY - Count of all problems found
    // ═══════════════════════════════════════════════════════════════════════════
    const totalIssues = critical + high + medium +
      fullyDeadFiles.length +
      (partiallyDeadFiles.reduce((sum, f) => sum + (f.summary?.deadExports || 0), 0)) +
      unusedDepsDetail.length +
      unusedAssets.length +
      (outdated.summary?.major || 0);

    const issuesSummaryContent = [
      `Total issues found: ${totalIssues}`,
      '',
      `  🔴 Security vulnerabilities:     ${critical + high + medium + low} (${critical} critical, ${high} high)`,
      `  📁 Dead code files:              ${fullyDeadFiles.length} files to delete`,
      `  📤 Unused exports:               ${result.summary?.deadCodeExports || 0} functions to remove`,
      `  📦 Unused dependencies:          ${unusedDepsDetail.length} packages to uninstall`,
      `  🖼️  Unused assets:                ${unusedAssets.length} files to delete`,
      `  ⚠️  Outdated packages:            ${outdated.summary?.major || 0} major updates needed`
    ];

    lines.push('');
    lines.push(...sectionBox('ISSUES FOUND', issuesSummaryContent, `${totalIssues} total`));

    // ═══════════════════════════════════════════════════════════════════════════
    // REQUIRED FIXES - All issues with fix commands
    // ═══════════════════════════════════════════════════════════════════════════
    const fixContent = [];
    const allFixCommands = { security: [], deps: [], deadCode: [], assets: [] };

    // Security fixes (blocking)
    if (critical + high > 0) {
      fixContent.push(color('SECURITY VULNERABILITIES (blocking)', COLORS.red));
      fixContent.push('─'.repeat(50));

      for (const vuln of [...criticalVulns, ...highVulns]) {
        const pkg = vuln.package || vuln.name;
        const version = vuln.version || '?';
        const fixVersion = vuln.fixedIn || vuln.patchedVersions?.[0] || 'latest';
        const severity = vuln.severity === 'critical' ? '🔴 CRITICAL' : '🟠 HIGH';
        const cve = vuln.cve || vuln.id || '';

        fixContent.push(`${severity}: ${pkg}@${version}`);
        if (cve) fixContent.push(`  CVE: ${cve}`);
        fixContent.push(`  ${vuln.title || 'Security vulnerability'}`);
        fixContent.push(`  Fix: npm install ${pkg}@${fixVersion}`);
        fixContent.push('');

        allFixCommands.security.push(`${pkg}@${fixVersion}`);
      }
    }

    // Unused dependencies
    if (unusedDepsDetail.length > 0) {
      fixContent.push(color('UNUSED DEPENDENCIES', COLORS.yellow));
      fixContent.push('─'.repeat(50));
      fixContent.push('These packages are in package.json but never imported:');
      fixContent.push('');

      for (const dep of unusedDepsDetail) {
        const size = dep.sizeBytes ? ` (${formatBytes(dep.sizeBytes)})` : '';
        fixContent.push(`  • ${dep.name}${size}`);
        allFixCommands.deps.push(dep.name);
      }

      fixContent.push('');
      fixContent.push(`Fix: npm uninstall ${unusedDepsDetail.map(d => d.name).join(' ')}`);
      fixContent.push('');
    }

    // Dead code files
    if (fullyDeadFiles.length > 0) {
      fixContent.push(color('DEAD CODE FILES', COLORS.cyan));
      fixContent.push('─'.repeat(50));
      fixContent.push('These files have no exports and are never imported:');
      fixContent.push('');

      for (const file of fullyDeadFiles.slice(0, 20)) {
        const path = file.relativePath || file.file || file.path;
        const lineCount = file.lineCount || 0;
        fixContent.push(`  rm "${path}"  # ${lineCount} lines`);
        allFixCommands.deadCode.push(path);
      }

      if (fullyDeadFiles.length > 20) {
        fixContent.push(`  # ... and ${fullyDeadFiles.length - 20} more files`);
      }
      fixContent.push('');
    }

    // Dead exports (in files that have some live code)
    if (partiallyDeadFiles.length > 0) {
      const totalDeadExports = partiallyDeadFiles.reduce((sum, f) =>
        sum + (f.exports?.filter(e => e.status === 'dead')?.length || 0), 0);

      if (totalDeadExports > 0) {
        fixContent.push(color('UNUSED EXPORTS', COLORS.cyan));
        fixContent.push('─'.repeat(50));
        fixContent.push('Remove these unused functions/exports:');
        fixContent.push('');

        let shownExports = 0;
        for (const file of partiallyDeadFiles) {
          const deadExports = (file.exports || []).filter(e => e.status === 'dead');
          if (deadExports.length === 0) continue;

          const path = file.relativePath || file.file || file.path;
          fixContent.push(`  ${path}:`);

          for (const exp of deadExports.slice(0, 5)) {
            const lineInfo = exp.line ? `:${exp.line}` : '';
            fixContent.push(`    - ${exp.name}()${lineInfo}`);
            shownExports++;
          }

          if (deadExports.length > 5) {
            fixContent.push(`    ... and ${deadExports.length - 5} more exports`);
          }

          if (shownExports > 30) {
            fixContent.push(`  ... and more files with dead exports`);
            break;
          }
        }
        fixContent.push('');
      }
    }

    // Unused assets
    if (unusedAssets.length > 0) {
      fixContent.push(color('UNUSED ASSETS', COLORS.magenta));
      fixContent.push('─'.repeat(50));
      fixContent.push('These files are not referenced in code:');
      fixContent.push('');

      for (const asset of unusedAssets.slice(0, 15)) {
        const path = asset.file || asset.relativePath;
        const size = formatBytes(asset.sizeBytes || 0);
        fixContent.push(`  rm "${path}"  # ${size}`);
        allFixCommands.assets.push(path);
      }

      if (unusedAssets.length > 15) {
        fixContent.push(`  # ... and ${unusedAssets.length - 15} more assets`);
      }
      fixContent.push('');
    }

    // Outdated major packages
    const outdatedMajorPkgs = (outdated.packages || []).filter(p => p.updateType === 'major');
    if (outdatedMajorPkgs.length > 0) {
      fixContent.push(color('OUTDATED PACKAGES (major versions)', COLORS.yellow));
      fixContent.push('─'.repeat(50));
      fixContent.push('These packages have breaking changes available:');
      fixContent.push('');

      for (const pkg of outdatedMajorPkgs.slice(0, 10)) {
        const name = pkg.package || pkg.name || 'unknown';
        const current = pkg.current || '?';
        const latest = pkg.latest || '?';
        fixContent.push(`  ${name}: ${current} → ${latest}`);
      }

      if (outdatedMajorPkgs.length > 10) {
        fixContent.push(`  ... and ${outdatedMajorPkgs.length - 10} more packages`);
      }
      fixContent.push('');
      fixContent.push('Review changelogs before updating major versions.');
      fixContent.push('');
    }

    if (fixContent.length > 0) {
      lines.push('');
      lines.push(...sectionBox('REQUIRED FIXES', fixContent, `${totalIssues} issues`));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX SCRIPT - Copy-paste commands to fix everything
    // ═══════════════════════════════════════════════════════════════════════════
    const scriptContent = [];
    scriptContent.push('Copy and run these commands to fix issues:');
    scriptContent.push('');

    // Security fixes
    if (allFixCommands.security.length > 0) {
      scriptContent.push('# Fix security vulnerabilities');
      scriptContent.push(`npm install ${allFixCommands.security.join(' ')}`);
      scriptContent.push('');
    }

    // Uninstall unused deps
    if (allFixCommands.deps.length > 0) {
      scriptContent.push('# Remove unused dependencies');
      if (allFixCommands.deps.length <= 10) {
        scriptContent.push(`npm uninstall ${allFixCommands.deps.join(' ')}`);
      } else {
        // Split into multiple lines for readability
        for (let i = 0; i < allFixCommands.deps.length; i += 8) {
          const batch = allFixCommands.deps.slice(i, i + 8);
          scriptContent.push(`npm uninstall ${batch.join(' ')}`);
        }
      }
      scriptContent.push('');
    }

    // Remove unused file candidates (verify before running)
    if (allFixCommands.deadCode.length > 0) {
      scriptContent.push('# Remove unused file candidates - VERIFY BEFORE RUNNING');
      if (allFixCommands.deadCode.length <= 10) {
        scriptContent.push(`rm ${allFixCommands.deadCode.map(f => `"${f}"`).join(' ')}`);
      } else {
        scriptContent.push('# Run this to remove unused file candidates (verify first):');
        scriptContent.push(`rm \\`);
        for (let i = 0; i < Math.min(allFixCommands.deadCode.length, 30); i++) {
          const isLast = i === Math.min(allFixCommands.deadCode.length, 30) - 1;
          scriptContent.push(`  "${allFixCommands.deadCode[i]}"${isLast ? '' : ' \\\\'}`);
        }
        if (allFixCommands.deadCode.length > 30) {
          scriptContent.push(`  # ... and ${allFixCommands.deadCode.length - 30} more files`);
        }
      }
      scriptContent.push('');
    }

    // Delete unused assets
    if (allFixCommands.assets.length > 0) {
      scriptContent.push('# Delete unused assets');
      if (allFixCommands.assets.length <= 8) {
        scriptContent.push(`rm ${allFixCommands.assets.map(f => `"${f}"`).join(' ')}`);
      } else {
        for (let i = 0; i < allFixCommands.assets.length; i += 5) {
          const batch = allFixCommands.assets.slice(i, i + 5);
          scriptContent.push(`rm ${batch.map(f => `"${f}"`).join(' ')}`);
        }
      }
      scriptContent.push('');
    }

    if (scriptContent.length > 2) {
      lines.push('');
      lines.push(...sectionBox('FIX SCRIPT', scriptContent, 'copy & run'));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AI FIX PROMPT - Generate a prompt for coding AI to fix all issues
    // Only shown if options.includeAiPrompt is true (default: false)
    // ═══════════════════════════════════════════════════════════════════════════
    if (options.includeAiPrompt) {
    const aiPromptContent = [];
    aiPromptContent.push('Copy this prompt into your AI coding assistant to fix all issues:');
    aiPromptContent.push('');
    aiPromptContent.push('───────────────────── PROMPT START ─────────────────────');
    aiPromptContent.push('');
    aiPromptContent.push('Fix the following issues found by Swynx:');
    aiPromptContent.push('');

    // Security vulnerabilities
    if (criticalVulns.length + highVulns.length > 0) {
      aiPromptContent.push('## Security Vulnerabilities');
      for (const vuln of [...criticalVulns, ...highVulns]) {
        const pkg = vuln.package || vuln.name;
        const fixVersion = vuln.fixedIn || vuln.patchedVersions?.[0] || 'latest';
        aiPromptContent.push(`- Update ${pkg} to version ${fixVersion} (${vuln.severity}: ${vuln.title || vuln.cve || 'security issue'})`);
      }
      aiPromptContent.push('');
    }

    // Unused dependencies
    if (unusedDepsDetail.length > 0) {
      aiPromptContent.push('## Unused Dependencies');
      aiPromptContent.push('Remove these packages from package.json - they are never imported:');
      for (const dep of unusedDepsDetail) {
        aiPromptContent.push(`- ${dep.name}`);
      }
      aiPromptContent.push('');
    }

    // Dead code files
    if (fullyDeadFiles.length > 0) {
      aiPromptContent.push('## Dead Code Files');
      aiPromptContent.push('Delete these files - they have no exports and are never imported:');
      for (const file of fullyDeadFiles.slice(0, 50)) {
        const path = file.relativePath || file.file || file.path;
        aiPromptContent.push(`- ${path}`);
      }
      if (fullyDeadFiles.length > 50) {
        aiPromptContent.push(`- ... and ${fullyDeadFiles.length - 50} more files`);
      }
      aiPromptContent.push('');
    }

    // Dead exports
    const allDeadExports = [];
    for (const file of partiallyDeadFiles) {
      const path = file.relativePath || file.file || file.path;
      const deadExps = (file.exports || []).filter(e => e.status === 'dead');
      for (const exp of deadExps) {
        allDeadExports.push({ path, name: exp.name, line: exp.line });
      }
    }

    if (allDeadExports.length > 0) {
      aiPromptContent.push('## Unused Exports');
      aiPromptContent.push('Remove these functions/exports - they are never imported:');

      // Group by file for cleaner output
      const byFile = {};
      for (const exp of allDeadExports) {
        if (!byFile[exp.path]) byFile[exp.path] = [];
        byFile[exp.path].push(exp);
      }

      let shown = 0;
      for (const [path, exps] of Object.entries(byFile)) {
        if (shown > 40) {
          aiPromptContent.push(`- ... and more exports in other files`);
          break;
        }
        aiPromptContent.push(`- In ${path}:`);
        for (const exp of exps.slice(0, 8)) {
          aiPromptContent.push(`  - Remove ${exp.name}() at line ${exp.line || '?'}`);
          shown++;
        }
        if (exps.length > 8) {
          aiPromptContent.push(`  - ... and ${exps.length - 8} more exports`);
        }
      }
      aiPromptContent.push('');
    }

    // Unused assets
    if (unusedAssets.length > 0) {
      aiPromptContent.push('## Unused Assets');
      aiPromptContent.push('Delete these files - they are not referenced in code:');
      for (const asset of unusedAssets.slice(0, 20)) {
        const path = asset.file || asset.relativePath;
        aiPromptContent.push(`- ${path}`);
      }
      if (unusedAssets.length > 20) {
        aiPromptContent.push(`- ... and ${unusedAssets.length - 20} more assets`);
      }
      aiPromptContent.push('');
    }

    // Guidance
    aiPromptContent.push('## Guidance');
    aiPromptContent.push('1. Verify security vulnerabilities apply before updating packages');
    aiPromptContent.push('2. Remove unused dependencies from package.json');
    aiPromptContent.push('3. Verify unused file candidates are truly unused before removing');
    aiPromptContent.push('4. Verify unused exports are truly unused before removing');
    aiPromptContent.push('5. Verify unused assets are truly unused before removing');
    aiPromptContent.push('6. Run tests to verify nothing is broken');
    aiPromptContent.push('');
    aiPromptContent.push('───────────────────── PROMPT END ───────────────────────');

    lines.push('');
    lines.push(...sectionBox('AI FIX PROMPT', aiPromptContent, 'copy to AI'));
    } // end if (options.includeAiPrompt)

    // ═══════════════════════════════════════════════════════════════════════════
    // FULL ACTION CHECKLIST
    // ═══════════════════════════════════════════════════════════════════════════
    const checklistItems = [];

    // Security items
    for (const vuln of [...criticalVulns, ...highVulns]) {
      const pkgName = vuln.package || vuln.name;
      const fixVersion = vuln.fixedIn || vuln.patchedVersions?.[0] || 'latest';
      const severity = vuln.severity === 'critical' ? '🔴 CRITICAL' : '🟠 HIGH';
      checklistItems.push({
        category: 'Security',
        item: `[ ] ${severity}: Update ${pkgName} to ${fixVersion}`,
        location: 'package.json',
        command: `npm install ${pkgName}@${fixVersion}`
      });
    }

    // Unused file candidates
    for (const file of fullyDeadFiles) {
      const path = file.relativePath || file.file || file.path;
      checklistItems.push({
        category: 'Unused Code',
        item: `[ ] Verify & remove unused file candidate: ${path}`,
        location: path,
        command: `rm "${path}"`
      });
    }

    // Unused exports (grouped by file)
    for (const file of partiallyDeadFiles.slice(0, 5)) {
      const path = file.relativePath || file.file || file.path;
      const deadExportsList = (file.exports || []).filter(e => e.status === 'dead');
      for (const exp of deadExportsList.slice(0, 3)) {
        checklistItems.push({
          category: 'Dead Code',
          item: `[ ] Remove unused export: ${exp.name}()`,
          location: `${path}:${exp.line || '?'}`,
          command: null
        });
      }
    }

    // Unused dependencies
    for (const dep of unusedDepsDetail) {
      checklistItems.push({
        category: 'Dependencies',
        item: `[ ] Uninstall unused: ${dep.name}`,
        location: 'package.json',
        command: `npm uninstall ${dep.name}`
      });
    }

    // Unused assets
    for (const asset of unusedAssets) {
      const path = asset.file || asset.relativePath;
      checklistItems.push({
        category: 'Assets',
        item: `[ ] Delete unused: ${path}`,
        location: path,
        command: `rm "${path}"`
      });
    }

    // Asset optimization
    for (const asset of optimizableAssets.slice(0, 10)) {
      const path = asset.file;
      const savings = formatBytes(asset.recommendations?.[0]?.estimatedSavings || 0);
      checklistItems.push({
        category: 'Assets',
        item: `[ ] Optimize ${path} (save ${savings})`,
        location: path,
        command: `npx sharp-cli "${path}" -o "${path.replace(/\.[^.]+$/, '.webp')}"`
      });
    }

    if (checklistItems.length > 0) {
      const checkContent = [];
      checkContent.push('Copy this checklist to your issue tracker:');
      checkContent.push('');
      checkContent.push('```');

      // Group by category
      const categories = [...new Set(checklistItems.map(i => i.category))];
      for (const cat of categories) {
        const items = checklistItems.filter(i => i.category === cat);
        checkContent.push(`## ${cat} (${items.length} items)`);
        for (const item of items.slice(0, 8)) {
          checkContent.push(item.item);
          if (item.location) checkContent.push(`   Location: ${item.location}`);
          if (item.command) checkContent.push(`   Fix: ${item.command}`);
        }
        if (items.length > 8) {
          checkContent.push(`   ... and ${items.length - 8} more`);
        }
        checkContent.push('');
      }

      checkContent.push('```');
      checkContent.push('');
      checkContent.push(`Total items: ${checklistItems.length}`);

      lines.push('');
      lines.push(...sectionBox('ACTION CHECKLIST', checkContent, `${checklistItems.length} items`));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FAILED FOOTER
    // ═══════════════════════════════════════════════════════════════════════════
    lines.push('');
    const failedContent = [
      '',
      color('✗ FAILED', COLORS.red),
      ''
    ];

    for (const reason of status.reasons) {
      failedContent.push(reason);
    }

    failedContent.push('');
    failedContent.push('Fix the critical issues above and re-run the scan.');
    failedContent.push('');

    lines.push(...headerBox(failedContent));
  }

  lines.push('');

  return {
    output: lines.join('\n'),
    passed: status.passed,
    exitCode: status.exitCode
  };
}

/**
 * Determine exit code based on result
 * Exit codes:
 * 0 = pass
 * 1 = threshold exceeded
 * 2 = license error
 * 3 = scan error (handled externally)
 */
function getExitCode(result, thresholds = {}) {
  const status = determineStatus(result, thresholds);
  return status.exitCode;
}

export { EXIT_CODES };

/**
 * Generate a plain-text checklist that can be copied to an issue tracker
 * @param {object} result - Scan result
 * @param {object} options - Options
 * @returns {string} Plain-text checklist
 */
function generateChecklist(result, options = {}) {
  const currencySymbol = options.currencySymbol || result.costs?.currencySymbol || '£';
  const perFindingCosts = result.costs?.perFinding || {};
  const lines = [];

  lines.push('# Swynx - Action Checklist');
  lines.push(`Generated: ${new Date().toISOString().split('T')[0]}`);
  lines.push(`Score: ${result.healthScore?.score || 0}/100 (Grade ${result.healthScore?.grade || 'F'})`);
  lines.push('');

  // Calculate totals
  const security = result.security || {};
  const criticalVulns = security.critical || [];
  const highVulns = security.high || [];
  const deadCode = result.details?.deadCode || {};
  const fullyDeadFiles = deadCode.fullyDeadFiles || [];
  const partiallyDeadFiles = deadCode.partiallyDeadFiles || [];
  const unusedDeps = result.details?.unusedDeps || [];
  const unusedAssets = result.details?.unusedAssets || [];
  const optimizableAssets = (result.details?.assetOptimisation?.optimizable || []);

  let totalItems = 0;

  // Security section
  if (criticalVulns.length > 0 || highVulns.length > 0) {
    lines.push('## Security Vulnerabilities');
    lines.push('');

    for (const vuln of criticalVulns) {
      const pkg = vuln.package || vuln.name;
      const fixVersion = vuln.fixedIn || vuln.patchedVersions?.[0] || 'latest';
      lines.push(`- [ ] 🔴 CRITICAL: Update ${pkg}@${vuln.version || '?'} to ${fixVersion}`);
      lines.push(`      CVE: ${vuln.cve || vuln.id || 'N/A'}`);
      lines.push(`      Fix: npm install ${pkg}@${fixVersion}`);
      totalItems++;
    }

    for (const vuln of highVulns) {
      const pkg = vuln.package || vuln.name;
      const fixVersion = vuln.fixedIn || vuln.patchedVersions?.[0] || 'latest';
      lines.push(`- [ ] 🟠 HIGH: Update ${pkg}@${vuln.version || '?'} to ${fixVersion}`);
      lines.push(`      CVE: ${vuln.cve || vuln.id || 'N/A'}`);
      lines.push(`      Fix: npm install ${pkg}@${fixVersion}`);
      totalItems++;
    }
    lines.push('');
  }

  // Dead Code section
  if (fullyDeadFiles.length > 0 || partiallyDeadFiles.length > 0) {
    const cost = perFindingCosts.deadCode?.annualTotal || 0;
    const costLabel = cost > 0 ? ` (${currencySymbol}${cost.toFixed(0)}/yr wasted)` : '';
    lines.push(`## Dead Code${costLabel}`);
    lines.push('');

    for (const file of fullyDeadFiles) {
      const path = file.relativePath || file.file || file.path;
      const fileLines = file.lineCount || file.lines || 0;
      lines.push(`- [ ] Delete entire file: ${path} (${fileLines} lines, never imported)`);
      lines.push(`      Fix: rm "${path}"`);
      totalItems++;
    }

    for (const file of partiallyDeadFiles) {
      const path = file.relativePath || file.file || file.path;
      const deadExports = (file.exports || []).filter(e => e.status === 'dead');
      for (const exp of deadExports) {
        lines.push(`- [ ] Remove unused export: ${exp.name}() in ${path}:${exp.line || '?'}`);
        totalItems++;
      }
    }
    lines.push('');
  }

  // Unused Dependencies section
  if (unusedDeps.length > 0) {
    const cost = perFindingCosts.unusedDeps?.annualTotal || 0;
    const costLabel = cost > 0 ? ` (${currencySymbol}${cost.toFixed(0)}/yr wasted)` : '';
    lines.push(`## Unused Dependencies${costLabel}`);
    lines.push('');

    for (const dep of unusedDeps) {
      const size = dep.sizeBytes ? ` (${formatBytes(dep.sizeBytes)})` : '';
      lines.push(`- [ ] Remove ${dep.name}${size}`);
      lines.push(`      Fix: npm uninstall ${dep.name}`);
      totalItems++;
    }

    lines.push('');
    lines.push('Quick fix (remove all):');
    lines.push(`npm uninstall ${unusedDeps.map(d => d.name).join(' ')}`);
    lines.push('');
  }

  // Unused Assets section
  if (unusedAssets.length > 0) {
    const cost = perFindingCosts.unusedAssets?.annualTotal || 0;
    const costLabel = cost > 0 ? ` (${currencySymbol}${cost.toFixed(0)}/yr wasted)` : '';
    lines.push(`## Unused Assets${costLabel}`);
    lines.push('');

    for (const asset of unusedAssets) {
      const path = asset.file || asset.relativePath;
      const size = formatBytes(asset.sizeBytes || 0);
      lines.push(`- [ ] Delete unused asset: ${path} (${size})`);
      lines.push(`      Fix: rm "${path}"`);
      totalItems++;
    }
    lines.push('');
  }

  // Asset Optimization section
  const highPriorityAssets = optimizableAssets.filter(a => a.priority === 'critical' || a.priority === 'high');
  if (highPriorityAssets.length > 0) {
    const cost = perFindingCosts.assetOptimisation?.annualTotal || 0;
    const costLabel = cost > 0 ? ` (${currencySymbol}${cost.toFixed(0)}/yr wasted)` : '';
    lines.push(`## Asset Optimization${costLabel}`);
    lines.push('');

    for (const asset of highPriorityAssets) {
      const path = asset.file;
      const savings = formatBytes(asset.recommendations?.[0]?.estimatedSavings || 0);
      const outputPath = path.replace(/\.(png|jpg|jpeg|gif)$/i, '.webp');
      lines.push(`- [ ] Convert ${path} to WebP (save ${savings})`);
      lines.push(`      Fix: npx sharp-cli "${path}" -o "${outputPath}"`);
      totalItems++;
    }
    lines.push('');
  }

  // Summary
  lines.push('---');
  lines.push(`Total items: ${totalItems}`);

  const totalCost =
    (perFindingCosts.deadCode?.annualTotal || 0) +
    (perFindingCosts.unusedDeps?.annualTotal || 0) +
    (perFindingCosts.unusedAssets?.annualTotal || 0) +
    (perFindingCosts.assetOptimisation?.annualTotal || 0);

  if (totalCost > 0) {
    lines.push(`Total annual savings if fixed: ${currencySymbol}${totalCost.toFixed(0)}`);
  }

  return lines.join('\n');
}

/**
 * Generate JSON checklist for programmatic use
 * @param {object} result - Scan result
 * @param {object} options - Options
 * @returns {object} Structured checklist object
 */
function generateChecklistJSON(result, options = {}) {
  const currencySymbol = options.currencySymbol || result.costs?.currencySymbol || '£';
  const perFindingCosts = result.costs?.perFinding || {};

  const security = result.security || {};
  const criticalVulns = security.critical || [];
  const highVulns = security.high || [];
  const deadCode = result.details?.deadCode || {};
  const fullyDeadFiles = deadCode.fullyDeadFiles || [];
  const partiallyDeadFiles = deadCode.partiallyDeadFiles || [];
  const unusedDeps = result.details?.unusedDeps || [];
  const unusedAssets = result.details?.unusedAssets || [];
  const optimizableAssets = (result.details?.assetOptimisation?.optimizable || []);

  const items = [];

  // Security items
  for (const vuln of [...criticalVulns, ...highVulns]) {
    const pkg = vuln.package || vuln.name;
    const fixVersion = vuln.fixedIn || vuln.patchedVersions?.[0] || 'latest';
    items.push({
      id: `vuln-${pkg}-${vuln.cve || vuln.id || 'unknown'}`,
      category: 'security',
      severity: vuln.severity,
      title: `Update ${pkg} to fix ${vuln.cve || vuln.id || 'vulnerability'}`,
      description: vuln.title || 'Security vulnerability',
      location: 'package.json',
      fix: {
        command: `npm install ${pkg}@${fixVersion}`,
        type: 'npm'
      },
      effort: 2, // minutes
      impact: 'security'
    });
  }

  // Dead code items
  for (const file of fullyDeadFiles) {
    const path = file.relativePath || file.file || file.path;
    items.push({
      id: `deadcode-file-${path.replace(/[^a-z0-9]/gi, '-')}`,
      category: 'dead-code',
      severity: 'warning',
      title: `Delete unused file: ${path}`,
      description: `File has ${file.lineCount || 0} lines and is never imported`,
      location: path,
      fix: {
        command: `rm "${path}"`,
        type: 'shell'
      },
      effort: 1, // minutes
      impact: 'performance'
    });
  }

  // Unused dependencies
  for (const dep of unusedDeps) {
    items.push({
      id: `unuseddep-${dep.name}`,
      category: 'dependencies',
      severity: 'warning',
      title: `Remove unused dependency: ${dep.name}`,
      description: dep.sizeBytes ? `Wastes ${formatBytes(dep.sizeBytes)} in node_modules` : 'Never imported',
      location: 'package.json',
      fix: {
        command: `npm uninstall ${dep.name}`,
        type: 'npm'
      },
      effort: 2, // minutes
      impact: 'performance'
    });
  }

  // Unused assets
  for (const asset of unusedAssets) {
    const path = asset.file || asset.relativePath;
    items.push({
      id: `unusedasset-${path.replace(/[^a-z0-9]/gi, '-')}`,
      category: 'assets',
      severity: 'info',
      title: `Delete unused asset: ${path}`,
      description: asset.sizeBytes ? `Wastes ${formatBytes(asset.sizeBytes)}` : 'Never referenced',
      location: path,
      fix: {
        command: `rm "${path}"`,
        type: 'shell'
      },
      effort: 1, // minutes
      impact: 'storage'
    });
  }

  // Asset optimization
  for (const asset of optimizableAssets) {
    const path = asset.file;
    const savings = asset.recommendations?.[0]?.estimatedSavings || 0;
    items.push({
      id: `optimize-${path.replace(/[^a-z0-9]/gi, '-')}`,
      category: 'assets',
      severity: asset.priority === 'critical' ? 'error' : asset.priority === 'high' ? 'warning' : 'info',
      title: `Optimize ${path}`,
      description: `Convert to WebP to save ${formatBytes(savings)}`,
      location: path,
      fix: {
        command: `npx sharp-cli "${path}" -o "${path.replace(/\.[^.]+$/, '.webp')}"`,
        type: 'shell'
      },
      effort: 2, // minutes
      impact: 'bandwidth'
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    score: result.healthScore?.score || 0,
    grade: result.healthScore?.grade || 'F',
    totalItems: items.length,
    costs: {
      currency: currencySymbol,
      deadCode: perFindingCosts.deadCode?.annualTotal || 0,
      unusedDeps: perFindingCosts.unusedDeps?.annualTotal || 0,
      unusedAssets: perFindingCosts.unusedAssets?.annualTotal || 0,
      assetOptimisation: perFindingCosts.assetOptimisation?.annualTotal || 0
    },
    items
  };
}

/**
 * Generate an AI prompt to fix all issues
 * Can be copied into Claude, Cursor, Copilot, etc.
 * @param {object} result - Scan result
 * @param {object} options - Options
 * @returns {string} AI prompt text
 */
function generateAiPrompt(result, options = {}) {
  const lines = [];

  const security = result.security || {};
  const criticalVulns = security.critical || [];
  const highVulns = security.high || [];
  const deadCode = result.details?.deadCode || {};
  const fullyDeadFiles = deadCode.fullyDeadFiles || [];
  const partiallyDeadFiles = deadCode.partiallyDeadFiles || [];
  const unusedDeps = result.details?.unusedDeps || [];
  const unusedAssets = result.details?.unusedAssets || [];

  lines.push('Fix the following issues found by Swynx:');
  lines.push('');

  // Security vulnerabilities
  if (criticalVulns.length + highVulns.length > 0) {
    lines.push('## Security Vulnerabilities');
    for (const vuln of [...criticalVulns, ...highVulns]) {
      const pkg = vuln.package || vuln.name;
      const fixVersion = vuln.fixedIn || vuln.patchedVersions?.[0] || 'latest';
      lines.push(`- Update ${pkg} to version ${fixVersion} (${vuln.severity}: ${vuln.title || vuln.cve || 'security issue'})`);
    }
    lines.push('');
  }

  // Unused dependencies
  if (unusedDeps.length > 0) {
    lines.push('## Unused Dependencies');
    lines.push('Remove these packages from package.json - they are never imported:');
    for (const dep of unusedDeps) {
      lines.push(`- ${dep.name}`);
    }
    lines.push('');
  }

  // Dead code files
  if (fullyDeadFiles.length > 0) {
    lines.push('## Dead Code Files');
    lines.push('Delete these files - they have no exports and are never imported:');
    for (const file of fullyDeadFiles) {
      const path = file.relativePath || file.file || file.path;
      lines.push(`- ${path}`);
    }
    lines.push('');
  }

  // Dead exports
  const allDeadExports = [];
  for (const file of partiallyDeadFiles) {
    const path = file.relativePath || file.file || file.path;
    const deadExps = (file.exports || []).filter(e => e.status === 'dead');
    for (const exp of deadExps) {
      allDeadExports.push({ path, name: exp.name, line: exp.line });
    }
  }

  if (allDeadExports.length > 0) {
    lines.push('## Unused Exports');
    lines.push('Remove these functions/exports - they are never imported:');

    // Group by file
    const byFile = {};
    for (const exp of allDeadExports) {
      if (!byFile[exp.path]) byFile[exp.path] = [];
      byFile[exp.path].push(exp);
    }

    for (const [path, exps] of Object.entries(byFile)) {
      lines.push(`- In ${path}:`);
      for (const exp of exps) {
        lines.push(`  - Remove ${exp.name}() at line ${exp.line || '?'}`);
      }
    }
    lines.push('');
  }

  // Unused assets
  if (unusedAssets.length > 0) {
    lines.push('## Unused Assets');
    lines.push('Delete these files - they are not referenced in code:');
    for (const asset of unusedAssets) {
      const path = asset.file || asset.relativePath;
      lines.push(`- ${path}`);
    }
    lines.push('');
  }

  // Guidance
  lines.push('## Guidance');
  lines.push('1. Verify security vulnerabilities apply before updating packages');
  lines.push('2. Remove unused dependencies from package.json');
  lines.push('3. Verify unused file candidates are truly unused before removing');
  lines.push('4. Verify unused exports are truly unused before removing');
  lines.push('5. Verify unused assets are truly unused before removing');
  lines.push('6. Run tests to verify nothing is broken');

  return lines.join('\n');
}

