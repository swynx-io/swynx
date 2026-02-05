/**
 * Update Command
 *
 * Provides manual update instructions for air-gapped environments.
 * NO external network calls - this is critical for security compliance.
 */

import pkg from '../../../package.json' with { type: 'json' };

// Version read automatically from package.json (bundled at build time)
export const VERSION = pkg.version;

/**
 * Get the current platform identifier
 */
function getPlatform() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'macos-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'macos-arm64';
  if (platform === 'win32' && arch === 'x64') return 'win-x64';

  return 'unknown';
}

/**
 * Show manual update instructions
 * NO network calls - air-gap compliant
 */
export async function updateCommand() {
  const platform = getPlatform();

  console.log(`
Swynx Update Instructions
==============================

Current version: v${VERSION}
Platform: ${platform}

Swynx is designed for air-gapped environments and does not
check for updates automatically. To update:

1. Download the latest version from your customer portal:
   https://swynx.oynk.co.uk/releases

   Or contact: support@oynk.co.uk

2. Stop the dashboard (if running as a service):
   systemctl stop swynx-dashboard

3. Replace the binary:
   cp swynx-${platform} /usr/local/bin/swynx
   chmod +x /usr/local/bin/swynx

4. Restart the dashboard:
   systemctl start swynx-dashboard

Your configuration and scan data in /var/lib/swynx/ (or ~/.swynx/)
will be preserved across updates.
`);
}

/**
 * No-op: Update check on startup is disabled for air-gap compliance
 * This function exists for backwards compatibility but does nothing.
 */
export async function checkUpdateOnStartup() {
  // Intentionally empty - no network calls allowed
}

/**
 * No-op: Returns null, no network calls
 */
export async function checkForUpdate() {
  return null;
}

/**
 * No-op: Returns false, shows manual instructions instead
 */
export async function installUpdate() {
  await updateCommand();
  return false;
}

/**
 * Get current version info (local only, no network)
 */
export function getVersionInfo() {
  return {
    version: VERSION,
    platform: getPlatform(),
    nodeVersion: process.version
  };
}

export default {
  VERSION,
  checkForUpdate,
  installUpdate,
  checkUpdateOnStartup,
  getVersionInfo,
  updateCommand
};
