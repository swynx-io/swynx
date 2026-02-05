// src/cli/commands/scan.mjs
// Scan command implementation

import { scanProject } from '../../scanner/index.mjs';
import { saveScan } from '../../storage/index.mjs';
import { loadConfig } from '../../config/index.mjs';
import {
  resolveCIConfig,
  hasEnabledIntegrations,
  runIntegrations,
  logIntegrationResults
} from '../../integrations/index.mjs';
import { formatCIOutput } from '../../reporter/ci.mjs';

// Exit codes
// 0 = pass
// 1 = threshold exceeded
// 2 = license error
// 3 = scan error
const EXIT_SUCCESS = 0;
const EXIT_SCAN_ERROR = 3;

/**
 * Detect CI environment
 */
function isCI() {
  return !!(
    process.env.CI === 'true' ||
    process.env.CI === '1' ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.JENKINS_URL ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.TF_BUILD ||
    process.env.BITBUCKET_BUILD_NUMBER
  );
}

/**
 * Silent progress reporter for CI mode
 */
function silentProgress() {
  // No output
}

export async function scanCommand(projectPath, options) {
  // Determine if we're in CI mode
  const ciMode = options.ci || isCI();

  // In CI mode, be quiet unless there's an error
  if (!ciMode) {
    console.log(`\n Scanning ${projectPath}...\n`);
  }

  try {
    // Load configuration with hierarchy: defaults < global < project < CLI
    const cliCostOptions = {
      monthlyLoads: options.monthlyLoads,
      bandwidthCost: options.bandwidthCost,
      cacheHitRate: options.cacheHitRate,
      storageCost: options.storageCost,
      developerRate: options.developerRate,
      co2PerGb: options.co2PerGb,
      currency: options.currency,
      costMode: options.costMode
    };

    const config = await loadConfig(options.config, projectPath, cliCostOptions, { quiet: ciMode });

    // Handle --dynamic-pattern CLI option (comma-separated patterns)
    if (options.dynamicPattern) {
      config.deadCode = config.deadCode || {};
      config.deadCode.dynamicPatterns = options.dynamicPattern.split(',').map(p => p.trim());
    }

    // Configure scanner for CI mode (suppress progress bar)
    const scanConfig = ciMode ? { ...config, onProgress: silentProgress } : config;
    const result = await scanProject(projectPath, scanConfig);

    // Save to database
    await saveScan(result);

    // Run CI/CD integrations
    const ciConfig = resolveCIConfig(config, {
      slackWebhook: options.slackWebhook,
      githubAnnotations: options.githubAnnotations,
      githubSummary: options.githubSummary,
      gitlabCodequality: options.gitlabCodequality,
      jenkinsConsole: options.jenkinsConsole
    });

    if (hasEnabledIntegrations(ciConfig)) {
      // Run integrations in parallel (non-blocking)
      const integrationResults = await runIntegrations(result, ciConfig, {
        projectName: result.projectName || projectPath
      });

      // Log any integration errors (non-blocking)
      logIntegrationResults(integrationResults, !ciMode);
    }

    // CI mode output
    if (ciMode) {
      if (options.output === 'json' || options.file?.endsWith('.json')) {
        // Write JSON to file or stdout
        const jsonOutput = JSON.stringify(result, null, 2);
        if (options.file) {
          const { writeFileSync } = await import('fs');
          writeFileSync(options.file, jsonOutput);
        } else {
          console.log(jsonOutput);
        }
        process.exit(EXIT_SUCCESS);
        return;
      }

      // Premium CI output with box-drawing characters
      const ciResult = formatCIOutput(result, {
        version: '1.0.5',
        license: 'OYNK (Enterprise + CI/CD)',
        currencySymbol: config.costs?.currencySymbol || '£',
        thresholds: config.thresholds || {},
        includeAiPrompt: options.aiPrompt || false
      });

      // Output to console
      console.log(ciResult.output);

      // Write to file if specified
      if (options.file) {
        const { writeFileSync } = await import('fs');
        writeFileSync(options.file, ciResult.output);
      }

      // Exit with appropriate code based on pass/fail
      process.exit(ciResult.exitCode);
      return;
    }

    // Interactive mode output
    console.log(' Scan Complete\n');
    console.log(` Files scanned:    ${result.summary.fileCount}`);
    console.log(` JavaScript files: ${result.summary.jsFileCount}`);
    console.log(` CSS files:        ${result.summary.cssFileCount}`);
    console.log(` Assets:           ${result.summary.assetFileCount}`);
    console.log('');
    console.log(` Total size:       ${formatBytes(result.summary.totalSizeBytes)}`);
    console.log(` Waste:            ${formatBytes(result.summary.wasteSizeBytes)} (${result.summary.wastePercent.toFixed(1)}%)`);
    console.log('');
    console.log(` Health Score:     ${result.healthScore.score}/100 (${result.healthScore.grade})`);
    console.log('');

    // Show emissions
    if (result.emissions) {
      console.log(` CO2/month:        ${result.emissions.current?.monthlyCO2Kg?.toFixed(2) || 0} kg`);
      console.log(` CO2/year:         ${result.emissions.current?.annualCO2Kg?.toFixed(2) || 0} kg`);
      console.log('');
    }

    // Show findings summary
    const criticalCount = result.findings?.critical?.length || 0;
    const warningCount = result.findings?.warning?.length || 0;
    const infoCount = result.findings?.info?.length || 0;

    if (criticalCount > 0 || warningCount > 0) {
      console.log(' Findings:');
      if (criticalCount > 0) console.log(`   Critical: ${criticalCount}`);
      if (warningCount > 0) console.log(`   Warning:  ${warningCount}`);
      if (infoCount > 0) console.log(`   Info:     ${infoCount}`);
      console.log('');
    }

    // Output to file if requested
    if (options.file) {
      const { writeFileSync } = await import('fs');
      if (options.output === 'json') {
        writeFileSync(options.file, JSON.stringify(result, null, 2));
      } else {
        writeFileSync(options.file, generateTextReport(result));
      }
      console.log(` Report saved to: ${options.file}\n`);
    }

    // Fail on waste threshold (legacy support)
    if (options.failOnWaste) {
      const threshold = parseFloat(options.failOnWaste);
      if (result.summary.wastePercent > threshold) {
        console.error(` Waste ${result.summary.wastePercent.toFixed(1)}% exceeds threshold ${threshold}%\n`);
        process.exit(1);
      }
    }

  } catch (error) {
    if (ciMode) {
      console.error(`PEER-AUDIT ERROR: ${error.message}`);
    } else {
      console.error(` Scan failed: ${error.message}\n`);
    }
    process.exit(EXIT_SCAN_ERROR);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function generateTextReport(result) {
  return `Codebase Audit Report
=====================

Project: ${result.projectPath}
Scanned: ${result.scannedAt}

Summary
-------
Files: ${result.summary.fileCount}
Size: ${formatBytes(result.summary.totalSizeBytes)}
Waste: ${formatBytes(result.summary.wasteSizeBytes)} (${result.summary.wastePercent.toFixed(1)}%)
Health Score: ${result.healthScore.score}/100 (${result.healthScore.grade})

Emissions
---------
Monthly CO2: ${result.emissions?.current?.monthlyCO2Kg?.toFixed(2) || 0} kg
Annual CO2: ${result.emissions?.current?.annualCO2Kg?.toFixed(2) || 0} kg
`;
}

export default scanCommand;
