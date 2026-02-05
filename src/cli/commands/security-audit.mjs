// src/cli/commands/security-audit.mjs
// Security audit command for verifying air-gap architecture

import {
  runSecurityAudit,
  getNetworkAuditLog,
  listGlobalStorage,
  generateMachineFingerprintSync
} from '../../security/index.mjs';

/**
 * Register security-audit command
 */
export function register(program) {
  program
    .command('security-audit')
    .description('Verify Swynx security architecture and data containment')
    .option('--show-global', 'List all files in global storage with descriptions')
    .option('--show-network-log', 'Show network audit log entries')
    .option('--show-fingerprint', 'Display machine fingerprint (for offline activation)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await runCommand(options);
    });
}

async function runCommand(options) {
  const isJson = options.json;

  if (!isJson) {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║           P.E.E.R. AUDIT SECURITY VERIFICATION                ║');
    console.log('║              Triple Air-Gap Architecture                       ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
  }

  // Run comprehensive audit
  const audit = runSecurityAudit({ showGlobal: options.showGlobal });

  if (isJson) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }

  // Display results
  const statusIcon = (status) => {
    if (status === 'PASS') return '✓';
    if (status === 'WARN') return '⚠';
    return '✗';
  };

  const statusColor = (status) => {
    if (status === 'PASS') return '\x1b[32m'; // Green
    if (status === 'WARN') return '\x1b[33m'; // Yellow
    return '\x1b[31m'; // Red
  };

  const reset = '\x1b[0m';
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';

  // Overall status
  console.log(`${bold}Overall Status:${reset} ${statusColor(audit.overallStatus)}${statusIcon(audit.overallStatus)} ${audit.overallStatus}${reset}`);
  console.log('');

  // Layer 1
  const l1 = audit.layers.layer1;
  console.log(`${bold}━━━ Layer 1: ${l1.name} ━━━${reset}`);
  console.log(`    Status: ${statusColor(l1.status)}${statusIcon(l1.status)} ${l1.status}${reset}`);
  console.log(`    ${dim}Telemetry packages checked:${reset} ${l1.details.packagesChecked}`);
  console.log(`    ${dim}Telemetry packages found:${reset} ${l1.details.telemetryPackagesFound.length === 0 ? 'None (clean)' : l1.details.telemetryPackagesFound.join(', ')}`);
  console.log(`    ${dim}Network audit log:${reset} ${l1.details.networkAuditLogExists ? `Active (${l1.details.networkAuditEntries} entries)` : 'Not yet created'}`);
  console.log('');

  // Layer 2
  const l2 = audit.layers.layer2;
  console.log(`${bold}━━━ Layer 2: ${l2.name} ━━━${reset}`);
  console.log(`    Status: ${statusColor(l2.status)}${statusIcon(l2.status)} ${l2.status}${reset}`);
  console.log(`    ${dim}Offline activation:${reset} Supported`);
  console.log(`    ${dim}License file:${reset} ${l2.details.licenseFilePresent ? (l2.details.licenseValid ? 'Valid' : 'Expired') : 'Not present'}`);
  console.log(`    ${dim}Local verification:${reset} Enabled`);
  console.log(`    ${dim}Phone-home required:${reset} No`);
  console.log('');

  // Layer 3
  const l3 = audit.layers.layer3;
  console.log(`${bold}━━━ Layer 3: ${l3.name} ━━━${reset}`);
  console.log(`    Status: ${statusColor(l3.status)}${statusIcon(l3.status)} ${l3.status}${reset}`);
  console.log(`    ${dim}Global storage compliant:${reset} ${l3.details.globalStorageCompliant ? 'Yes' : 'No'}`);
  console.log(`    ${dim}Files in global storage:${reset} ${l3.details.globalFiles.length}`);

  if (l3.details.violations > 0) {
    console.log(`    ${dim}Violations:${reset} ${l3.details.violations}`);
  }
  console.log('');

  // Show global storage if requested
  if (options.showGlobal) {
    console.log(`${bold}━━━ Global Storage Contents (~/.swynx/) ━━━${reset}`);
    console.log('');

    const globalFiles = listGlobalStorage();
    if (globalFiles.length === 0) {
      console.log('    No files in global storage');
    } else {
      for (const file of globalFiles) {
        const warning = file.containsCode ? ' ⚠ CONTAINS CODE DATA' : '';
        console.log(`    ${file.name}`);
        console.log(`        ${dim}Size:${reset} ${file.sizeFormatted}`);
        console.log(`        ${dim}Description:${reset} ${file.description}${warning}`);
        console.log('');
      }
    }
  }

  // Show network log if requested
  if (options.showNetworkLog) {
    console.log(`${bold}━━━ Network Audit Log (Last 20 entries) ━━━${reset}`);
    console.log('');

    const networkLog = getNetworkAuditLog(20);
    if (networkLog.length === 0) {
      console.log('    No network calls logged');
    } else {
      for (const entry of networkLog) {
        console.log(`    ${dim}${entry.timestamp}${reset}`);
        console.log(`        Endpoint: ${entry.endpoint}`);
        console.log(`        Purpose: ${entry.purpose}`);
        console.log(`        Data keys sent: ${entry.dataSent?.join(', ') || 'none'}`);
        console.log('');
      }
    }
  }

  // Show machine fingerprint if requested
  if (options.showFingerprint) {
    console.log(`${bold}━━━ Machine Fingerprint ━━━${reset}`);
    console.log('');

    const fingerprint = generateMachineFingerprintSync();
    console.log(`    Fingerprint: ${fingerprint.fingerprint}`);
    console.log(`    ${dim}Algorithm:${reset} ${fingerprint.algorithm}`);
    console.log(`    ${dim}Components:${reset} ${fingerprint.components} machine identifiers (hashed)`);
    console.log('');
    console.log(`    ${dim}Use this fingerprint for offline license activation.${reset}`);
    console.log(`    ${dim}Send to: licensing@oynk.co.uk${reset}`);
    console.log('');
  }

  // Issues and recommendations
  if (audit.issues.length > 0) {
    console.log(`${bold}━━━ Issues ━━━${reset}`);
    for (const issue of audit.issues) {
      console.log(`    ✗ ${issue}`);
    }
    console.log('');
  }

  if (audit.recommendations.length > 0) {
    console.log(`${bold}━━━ Recommendations ━━━${reset}`);
    for (const rec of audit.recommendations) {
      console.log(`    → ${rec}`);
    }
    console.log('');
  }

  // Summary
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`${dim}Your code never leaves your infrastructure.${reset}`);
  console.log(`${dim}Verify network activity: swynx scan /path --network-audit${reset}`);
  console.log('');
}

export default { register };
