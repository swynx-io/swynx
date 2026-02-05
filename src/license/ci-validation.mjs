/**
 * CI/CD License Validation
 *
 * Validates licenses in CI/CD environments where machine fingerprinting
 * is not feasible (ephemeral containers, runners, etc).
 *
 * Validates against: license key + email + git remote URL
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const CI_VALIDATION_API = 'https://swynx.oynk.co.uk/api/license/validate-ci';

export const EXIT_LICENSE_ERROR = 2;
export const EXIT_SCAN_ERROR = 3;

/**
 * Get git remote URL for the project
 */
async function getGitRemote(projectPath) {
  try {
    const { stdout } = await execAsync('git remote get-url origin', {
      cwd: projectPath,
      timeout: 5000
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Validate a license for CI/CD usage
 *
 * @param {string} projectPath - Path to the project being scanned
 * @param {string} licenseKey - License key (SWYX-XXXX-XXXX-XXXX-XXXX)
 * @param {string} email - Email associated with the license
 * @returns {Promise<{valid: boolean, error?: string, code?: string, tier?: string, licensee?: string, expires?: string}>}
 */
export async function validateCILicense(projectPath, licenseKey, email) {
  const gitRemoteUrl = await getGitRemote(projectPath);

  try {
    const response = await fetch(CI_VALIDATION_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: licenseKey,
        email,
        gitRemoteUrl: gitRemoteUrl || ''
      })
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      valid: false,
      error: `Failed to validate license: ${error.message}`,
      code: 'NETWORK_ERROR'
    };
  }
}

export default { validateCILicense, EXIT_LICENSE_ERROR, EXIT_SCAN_ERROR };
