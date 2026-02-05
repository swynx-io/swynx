/**
 * License Validation
 *
 * Main interface for license checking throughout the app.
 * Uses project IDs (from .swynx.json) instead of fingerprints.
 *
 * STRICT RULES:
 * - Projects cannot be removed by users
 * - Projects cannot be transferred/renamed by users
 * - Users can only: register new projects (if slots available) or point folders to existing projects
 */

import { getProjectFingerprint, getProjectDetails } from './fingerprint.mjs';
import {
  loadLicense,
  isProjectLicensed,
  isProjectIdLicensed,
  getLicenseStatus,
  registerProjectId,
  getProjectById,
  getRegisteredProjects,
  getSlotInfo
} from './storage.mjs';
import { activateLicense, activateProject, linkProject } from './activation.mjs';
import { validateCILicense, EXIT_LICENSE_ERROR, EXIT_SCAN_ERROR } from './ci-validation.mjs';
import { getProjectId } from '../config/index.mjs';

export { activateLicense, activateProject, linkProject };
export { getProjectFingerprint, getProjectDetails };
export { getLicenseStatus, getSlotInfo };
export { validateCILicense, EXIT_LICENSE_ERROR, EXIT_SCAN_ERROR };
export { registerProjectId, getProjectById, getRegisteredProjects };

// License tiers - updated limits per plan
export const LICENSE_TIERS = {
  TRIAL: {
    name: 'Trial',
    maxProjects: 3
  },
  STARTER: {
    name: 'Starter',
    maxProjects: 3
  },
  TEAM: {
    name: 'Team',
    maxProjects: 15
  },
  BUSINESS: {
    name: 'Business',
    maxProjects: 50
  },
  ENTERPRISE: {
    name: 'Enterprise',
    maxProjects: 999
  }
};

/**
 * Check if current project is licensed
 * Uses projectId from .swynx.json in project root
 * Falls back to fingerprint-based check for legacy support
 *
 * @param {string} projectPath - Path to the project directory
 * @returns {Promise<{licensed: boolean, projectId?: string, reason?: string, registeredProjects?: string[], slotsUsed?: number, slotsTotal?: number, slotsRemaining?: number}>}
 */
export async function checkProjectLicense(projectPath) {
  // First, try to get projectId from .swynx.json
  const projectId = await getProjectId(projectPath);

  if (projectId) {
    // New ID-based validation
    const result = await isProjectIdLicensed(projectId);
    return {
      ...result,
      projectId
    };
  }

  // Fallback: Legacy fingerprint-based check (for migration period)
  const fingerprint = await getProjectFingerprint(projectPath);
  const legacyResult = await isProjectLicensed(fingerprint);

  if (legacyResult.licensed) {
    // Found via legacy fingerprint - return with the project's ID
    return {
      ...legacyResult,
      projectId: legacyResult.project?.id || null,
      isLegacy: true
    };
  }

  // Not found by either method - need to pick/register
  const slotInfo = await getSlotInfo();
  const projects = await getRegisteredProjects();

  return {
    licensed: false,
    reason: 'Project not configured',
    needsSetup: true,
    registeredProjects: projects.map(p => p.id),
    slotsUsed: slotInfo.slotsUsed,
    slotsTotal: slotInfo.slotsTotal,
    slotsRemaining: slotInfo.slotsRemaining
  };
}

/**
 * Require valid license for project (throws/exits if invalid)
 *
 * @param {string} projectPath - Path to the project directory
 */
export async function requireProjectLicense(projectPath) {
  const result = await checkProjectLicense(projectPath);

  if (!result.licensed) {
    const details = await getProjectDetails(projectPath);

    console.error('\n  Project not licensed\n');
    console.error(` Project:   ${details.name}`);
    console.error(` Path:      ${details.path}`);

    if (result.projectId) {
      console.error(` Project ID: ${result.projectId}`);
    }
    console.error('');

    if (result.reason === 'No license found') {
      console.error(' No license activated on this machine.');
      console.error(' To activate:');
      console.error(`   swynx activate --project ${projectPath}`);
      console.error('');
    } else if (result.reason === 'License expired') {
      console.error(` Your license expired on ${result.expiredOn}`);
      console.error(' Renew at: https://oynk.co.uk/swynx/renew');
      console.error('');
    } else if (result.reason === 'Project not licensed' || result.needsSetup) {
      console.error(' This folder is not registered.');
      console.error('');
      console.error(' To register, run:');
      console.error(`   swynx scan ${projectPath}`);
      console.error('');
      console.error(' You will be prompted to select an existing project or register a new one.');
      console.error('');
    }

    process.exit(1);
  }

  return result;
}

/**
 * Require valid license (throws/exits if not available)
 * All features are included with any license - no feature gating
 */
export async function requireLicense(projectPath) {
  const license = await loadLicense();

  if (!license) {
    console.error('\n  No license found');
    console.error(' Run: swynx activate\n');
    process.exit(1);
  }

  // Check project is licensed if path provided
  if (projectPath) {
    await requireProjectLicense(projectPath);
  }

  return license;
}

// Keep requireFeature as alias for backwards compatibility (does same as requireLicense now)
export async function requireFeature(feature, featureName, projectPath) {
  return requireLicense(projectPath);
}

export default {
  LICENSE_TIERS,
  activateLicense,
  activateProject,
  linkProject,
  getProjectFingerprint,
  getProjectDetails,
  getLicenseStatus,
  getSlotInfo,
  checkProjectLicense,
  requireProjectLicense,
  requireLicense,
  requireFeature,
  validateCILicense,
  EXIT_LICENSE_ERROR,
  EXIT_SCAN_ERROR,
  // Project ID functions (no remove/transfer)
  registerProjectId,
  getProjectById,
  getRegisteredProjects
};
