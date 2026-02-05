// src/cli/commands/activate-offline.mjs
// Offline license activation for air-gapped environments

import { existsSync } from 'fs';
import {
  activateOffline,
  generateMachineFingerprintSync,
  logNetworkCall
} from '../../security/index.mjs';

/**
 * Register activate command with offline support
 */
export function register(program) {
  program
    .command('activate')
    .description('Activate Swynx license')
    .option('--license-file <path>', 'Path to signed license file (for offline activation)')
    .option('--key <key>', 'License key (for online activation)')
    .option('--fingerprint', 'Generate machine fingerprint for offline activation')
    .action(async (options) => {
      await runCommand(options);
    });
}

async function runCommand(options) {
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const reset = '\x1b[0m';

  console.log('');

  // If fingerprint requested, just show it
  if (options.fingerprint) {
    console.log(`${bold}Machine Fingerprint${reset}`);
    console.log('');

    const fingerprint = generateMachineFingerprintSync();
    console.log(`  ${fingerprint.fingerprint}`);
    console.log('');
    console.log(`${dim}Send this fingerprint to licensing@oynk.co.uk to receive${reset}`);
    console.log(`${dim}a signed license file for offline activation.${reset}`);
    console.log('');
    return;
  }

  // Offline activation with license file
  if (options.licenseFile) {
    console.log(`${bold}Offline License Activation${reset}`);
    console.log('');

    if (!existsSync(options.licenseFile)) {
      console.log(`${red}✗${reset} License file not found: ${options.licenseFile}`);
      process.exit(1);
    }

    const result = activateOffline(options.licenseFile);

    if (result.success) {
      console.log(`${green}✓${reset} License activated successfully`);
      console.log('');
      console.log(`  ${dim}License:${reset} ${result.license.key}`);
      console.log(`  ${dim}Valid until:${reset} ${result.license.validUntil}`);
      console.log(`  ${dim}Tier:${reset} ${result.license.tier}`);
      console.log(`  ${dim}Method:${reset} Offline activation (no network required)`);
      console.log('');
      console.log(`${dim}Your installation is now fully air-gapped.${reset}`);
      console.log(`${dim}No further network connectivity required.${reset}`);
    } else {
      console.log(`${red}✗${reset} Activation failed: ${result.error}`);
      process.exit(1);
    }

    return;
  }

  // Online activation with key
  if (options.key) {
    console.log(`${bold}Online License Activation${reset}`);
    console.log('');

    // This would call the license server
    // Log the network call for audit purposes
    logNetworkCall('https://api.oynk.co.uk/license/activate', 'license-activation', {
      licenseKey: '[REDACTED]',
      machineFingerprint: '[HASH]'
    });

    // Import and use existing license activation
    try {
      const { activateLicense } = await import('../../license/index.mjs');
      const result = await activateLicense(options.key);

      if (result.success) {
        console.log(`${green}✓${reset} License activated successfully`);
        console.log('');
        console.log(`  ${dim}License:${reset} ${options.key.substring(0, 8)}...`);
        console.log(`  ${dim}Valid until:${reset} ${result.license?.validUntil || 'See license file'}`);
        console.log('');
        console.log(`${dim}Network call logged to ~/.swynx/network-audit.log${reset}`);
      } else {
        console.log(`${red}✗${reset} Activation failed: ${result.error}`);
        process.exit(1);
      }
    } catch (err) {
      console.log(`${red}✗${reset} Activation failed: ${err.message}`);
      process.exit(1);
    }

    return;
  }

  // No options provided, show help
  console.log(`${bold}Swynx License Activation${reset}`);
  console.log('');
  console.log('For online activation:');
  console.log(`  ${dim}swynx activate --key YOUR_LICENSE_KEY${reset}`);
  console.log('');
  console.log('For offline/air-gapped activation:');
  console.log(`  ${dim}1. Generate fingerprint: swynx activate --fingerprint${reset}`);
  console.log(`  ${dim}2. Send fingerprint to licensing@oynk.co.uk${reset}`);
  console.log(`  ${dim}3. Receive signed license file${reset}`);
  console.log(`  ${dim}4. Activate: swynx activate --license-file license.json${reset}`);
  console.log('');
}

export default { register };
