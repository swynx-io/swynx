/**
 * License Activation
 *
 * Handles license activation and project registration.
 * Projects are identified by user-chosen IDs, stored in .swynx.json
 */

import { getProjectDetails } from './fingerprint.mjs';
import {
  saveLicense,
  loadLicense,
  registerProjectId,
  isProjectIdLicensed,
  getProjectById
} from './storage.mjs';
import { getProjectId, setProjectId } from '../config/index.mjs';
import { logNetworkCall } from '../security/index.mjs';
import { hostname } from 'os';
import { createHash } from 'crypto';

// Activation API endpoint
const ACTIVATION_API = 'https://swynx.oynk.co.uk/api/activate';

/**
 * Generate a machine fingerprint for API authentication
 */
function getMachineFingerprint() {
  const machineId = hostname() + process.platform + process.arch;
  return createHash('sha256').update(machineId).digest('hex').slice(0, 32);
}

/**
 * Activate a new license (first-time setup)
 *
 * @param {string|object} emailOrOptions - Email or options object
 * @param {string} orderId - License key
 * @param {string} projectPath - Optional project path
 * @param {string} projectId - Optional project ID (if not provided, uses folder name)
 */
export async function activateLicense(emailOrOptions, orderId, projectPath, projectId) {
  // Handle both call signatures
  let email;
  if (typeof emailOrOptions === 'object') {
    email = emailOrOptions.email;
    orderId = emailOrOptions.orderId;
    projectPath = emailOrOptions.projectPath;
    projectId = emailOrOptions.projectId;
  } else {
    email = emailOrOptions;
  }

  const machineFingerprint = getMachineFingerprint();

  // Log network call for security audit
  logNetworkCall(ACTIVATION_API, 'license-activation', {
    email: '[provided]',
    orderId: '[provided]',
    machineFingerprint: '[hash]'
  });

  // Call activation API
  const response = await fetch(ACTIVATION_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Swynx/1.0'
    },
    body: JSON.stringify({
      key: orderId,
      machineFingerprint
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Activation failed' }));
    throw new Error(error.error || `Activation failed: ${response.status}`);
  }

  const data = await response.json();

  if (!data.valid) {
    throw new Error(data.error || 'Activation failed');
  }

  // Map tier to tierName for display
  const tierNames = {
    trial: 'Trial',
    starter: 'Starter',
    team: 'Team',
    business: 'Business',
    enterprise: 'Enterprise'
  };

  // Save license to central store
  const licenseData = {
    licenseKey: orderId,
    email: data.email || email,
    tier: data.tier,
    tierName: tierNames[data.tier] || data.tier,
    maxProjects: data.maxProjects,
    expires: data.expires,
    activatedAt: new Date().toISOString(),
    cicdEnabled: data.cicdEnabled || false,
    projects: [],
    signature: data.signedLicense?.signature || null
  };

  await saveLicense(licenseData);

  // If a project path was provided, register the project
  let registeredProject = null;
  if (projectPath) {
    const details = await getProjectDetails(projectPath);
    const finalProjectId = projectId || details.name;

    // Register in central store
    const regResult = await registerProjectId(finalProjectId);
    if (regResult.success) {
      registeredProject = regResult.project;

      // Create .swynx.json in project
      await setProjectId(projectPath, regResult.project.id);
    }
  }

  return {
    success: true,
    tier: tierNames[data.tier] || data.tier,
    tierName: tierNames[data.tier] || data.tier,
    expires: data.expires,
    maxProjects: data.maxProjects,
    project: registeredProject
  };
}

/**
 * Activate/register a project with the existing license
 *
 * Flow:
 * 1. Check if .swynx.json exists with projectId
 *    - If yes and ID is registered: already licensed, done
 *    - If yes and ID not registered: error (ID exists but not in license)
 * 2. If no .swynx.json:
 *    - Use provided projectId or prompt for one
 *    - If ID exists in license: "point" this folder to it (create .swynx.json)
 *    - If ID is new: register it (use a slot)
 *
 * @param {string} projectPath - Path to the project
 * @param {object} options - Options { projectId, skipPrompt }
 * @returns {Promise<{success, projectId, alreadyLicensed?, newRegistration?, pointed?}>}
 */
export async function activateProject(projectPath, options = {}) {
  const license = await loadLicense();

  if (!license) {
    throw new Error('No license found. Run: swynx activate');
  }

  // Check expiry
  if (new Date() > new Date(license.expires)) {
    throw new Error(`License expired on ${license.expires}. Renew at: https://oynk.co.uk/swynx/renew`);
  }

  const details = await getProjectDetails(projectPath);

  // Step 1: Check if .swynx.json already exists with a projectId
  const existingProjectId = await getProjectId(projectPath);

  if (existingProjectId) {
    // Config exists - check if the ID is in the license
    const result = await isProjectIdLicensed(existingProjectId);

    if (result.licensed) {
      // Already licensed - nothing to do
      return {
        success: true,
        alreadyLicensed: true,
        projectId: existingProjectId,
        message: `Project "${existingProjectId}" is already licensed.`
      };
    } else {
      // Config exists but ID not in license - this is an error state
      throw new Error(
        `Project has ID "${existingProjectId}" but it's not registered in your license.\n` +
        `Registered IDs: ${result.registeredProjects?.join(', ') || 'none'}\n\n` +
        `Options:\n` +
        `  1. Register this ID: swynx activate --project ${projectPath} --id ${existingProjectId}\n` +
        `  2. Point to existing: Edit .swynx.json and change projectId`
      );
    }
  }

  // Step 2: No .swynx.json - determine projectId to use
  const projectId = options.projectId || details.name;

  // Check if this ID already exists in the license
  const existingProject = await getProjectById(projectId);

  if (existingProject) {
    // ID exists - "point" this folder to it (no new slot used)
    await setProjectId(projectPath, existingProject.id);

    return {
      success: true,
      pointed: true,
      projectId: existingProject.id,
      message: `Folder linked to existing project "${existingProject.id}".`,
      note: 'No slot used - this folder now points to an existing registered project.'
    };
  }

  // Step 3: New ID - register it (uses a slot)
  const regResult = await registerProjectId(projectId);

  if (!regResult.success) {
    throw new Error(regResult.error);
  }

  // Create .swynx.json
  await setProjectId(projectPath, regResult.project.id);

  return {
    success: true,
    newRegistration: true,
    projectId: regResult.project.id,
    slotsUsed: regResult.slotsUsed,
    slotsTotal: regResult.slotsTotal,
    message: `Project "${regResult.project.id}" registered.`,
    note: regResult.alreadyRegistered
      ? 'Project was already registered.'
      : `Slot used: ${regResult.slotsUsed}/${regResult.slotsTotal}`
  };
}

/**
 * Link a folder to an existing project ID
 * Used when moving/copying a project to a new location
 *
 * @param {string} projectPath - Path to the new project location
 * @param {string} projectId - Existing project ID to link to
 */
export async function linkProject(projectPath, projectId) {
  const license = await loadLicense();

  if (!license) {
    throw new Error('No license found. Run: swynx activate');
  }

  // Check if ID exists
  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error(
      `Project ID "${projectId}" not found in license.\n` +
      `Registered: ${license.projects.map(p => p.id).join(', ') || 'none'}`
    );
  }

  // Create .swynx.json linking to this ID
  await setProjectId(projectPath, project.id);

  return {
    success: true,
    projectId: project.id,
    message: `Folder linked to "${project.id}".`
  };
}

/**
 * Verify license with server (optional periodic check)
 */
export async function verifyLicense() {
  const license = await loadLicense();

  if (!license) {
    return { valid: false, reason: 'No license found' };
  }

  // Log network call for security audit
  logNetworkCall(`${ACTIVATION_API}/verify`, 'license-verification', {
    licenseKey: '[provided]',
    signature: '[provided]'
  });

  try {
    const response = await fetch(`${ACTIVATION_API}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Swynx/1.0'
      },
      body: JSON.stringify({
        orderId: license.licenseKey,
        signature: license.signature
      })
    });

    if (!response.ok) {
      return { valid: false, reason: 'License verification failed' };
    }

    const data = await response.json();
    return { valid: data.valid, reason: data.reason };
  } catch (error) {
    // Network error - allow offline use, rely on local expiry check
    return { valid: true, offline: true };
  }
}

export default {
  activateLicense,
  activateProject,
  linkProject,
  verifyLicense
};
