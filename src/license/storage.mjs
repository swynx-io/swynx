/**
 * License Storage
 *
 * Central license store at DATA_DIR/licenses.json (source of truth)
 * Project configs (.swynx.json) are just pointers with projectId
 *
 * STRICT RULES:
 * - Projects cannot be removed by users
 * - Projects cannot be transferred/renamed by users
 * - Users can only: register new projects (if slots available) or point folders to existing projects
 */

import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from '../config/index.mjs';

// New storage file (central store)
const LICENSES_FILE = join(DATA_DIR, 'licenses.json');
// Old storage file (for migration)
const LEGACY_LICENSE_FILE = join(DATA_DIR, 'license.json');

/**
 * Calculate remaining slots, handling unlimited (-1) case
 */
function calcSlotsRemaining(maxProjects, usedCount) {
  if (maxProjects === -1) return -1; // Unlimited
  return maxProjects - usedCount;
}

/**
 * Central license store structure:
 * {
 *   "licenseKey": "SWYX-XXXX-XXXX-XXXX-XXXX",
 *   "email": "user@example.com",
 *   "tier": "team",
 *   "tierName": "Team",
 *   "maxProjects": 15,
 *   "expires": "2027-01-31",
 *   "activatedAt": "2026-01-31T10:00:00Z",
 *   "cicdEnabled": true,
 *   "projects": [
 *     { "id": "EcoPigs", "activatedAt": "2026-01-31T10:00:00Z" },
 *     { "id": "Dashboard", "activatedAt": "2026-01-15T10:00:00Z" }
 *   ]
 * }
 */

/**
 * Check if migration is needed and perform it
 */
async function migrateIfNeeded() {
  // If new format exists, no migration needed
  if (existsSync(LICENSES_FILE)) {
    return;
  }

  // If old format exists, migrate
  if (existsSync(LEGACY_LICENSE_FILE)) {
    try {
      const oldContent = await readFile(LEGACY_LICENSE_FILE, 'utf-8');
      const oldLicense = JSON.parse(oldContent);

      // Convert old format to new format
      const newLicense = {
        licenseKey: oldLicense.orderId,
        email: oldLicense.email,
        tier: oldLicense.tier?.toLowerCase() || 'starter',
        tierName: oldLicense.tierName || oldLicense.tier || 'Starter',
        maxProjects: oldLicense.maxProjects || 3,
        expires: oldLicense.expires,
        activatedAt: oldLicense.activatedAt,
        cicdEnabled: oldLicense.cicdEnabled || false,
        signature: oldLicense.signature,
        projects: (oldLicense.projects || []).map(p => ({
          // Use project name as the new ID
          id: p.name || p.path?.split('/').pop() || 'project',
          activatedAt: p.activatedAt
        }))
      };

      // Save new format
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(LICENSES_FILE, JSON.stringify(newLicense, null, 2));

      // Backup old file
      await rename(LEGACY_LICENSE_FILE, `${LEGACY_LICENSE_FILE}.backup`);

      console.log('License migrated to new project-ID format.');
      console.log('Old license backed up to license.json.backup');
    } catch (error) {
      console.error('Error migrating license:', error.message);
    }
  }
}

/**
 * Load license from central store
 */
export async function loadLicense() {
  await migrateIfNeeded();

  if (!existsSync(LICENSES_FILE)) {
    return null;
  }

  try {
    const content = await readFile(LICENSES_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading license file:', error.message);
    return null;
  }
}

/**
 * Save license to central store
 */
export async function saveLicense(licenseData) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(LICENSES_FILE, JSON.stringify(licenseData, null, 2));
}

/**
 * Register a new project ID in the license
 * Returns { success, project, error, slotsUsed, slotsTotal, slotsRemaining }
 */
export async function registerProjectId(projectId) {
  const license = await loadLicense();

  if (!license) {
    return { success: false, error: 'No license found. Please activate first.' };
  }

  // Check if already registered
  const existing = license.projects.find(p => p.id.toLowerCase() === projectId.toLowerCase());
  if (existing) {
    return {
      success: true,
      alreadyRegistered: true,
      project: existing,
      slotsUsed: license.projects.length,
      slotsTotal: license.maxProjects,
      slotsRemaining: calcSlotsRemaining(license.maxProjects, license.projects.length)
    };
  }

  // Check slot limit (skip if unlimited: -1)
  if (license.maxProjects !== -1 && license.projects.length >= license.maxProjects) {
    return {
      success: false,
      error: `No slots remaining. Your ${license.tierName} license allows ${license.maxProjects} project(s).`,
      slotsUsed: license.projects.length,
      slotsTotal: license.maxProjects,
      slotsRemaining: 0,
      registeredProjects: license.projects.map(p => p.id)
    };
  }

  // Add new project (keep original casing for display)
  const newProject = {
    id: projectId,
    activatedAt: new Date().toISOString()
  };

  license.projects.push(newProject);
  await saveLicense(license);

  return {
    success: true,
    project: newProject,
    slotsUsed: license.projects.length,
    slotsTotal: license.maxProjects,
    slotsRemaining: calcSlotsRemaining(license.maxProjects, license.projects.length)
  };
}

/**
 * Unregister a project ID from the license
 * Only available for Enterprise tier licenses
 * Returns { success, removedProject, error, slotsUsed, slotsTotal, slotsRemaining }
 */
export async function unregisterProjectId(projectId) {
  const license = await loadLicense();

  if (!license) {
    return { success: false, error: 'No license found.' };
  }

  // Check if tier allows project removal (Enterprise only)
  const tierName = (license.tierName || license.tier || '').toLowerCase();
  if (tierName !== 'enterprise') {
    return {
      success: false,
      error: 'Project removal is only available for Enterprise licenses. Contact sales@oynk.co.uk to upgrade.',
      code: 'ENTERPRISE_ONLY',
      slotsUsed: license.projects.length,
      slotsTotal: license.maxProjects,
      slotsRemaining: calcSlotsRemaining(license.maxProjects, license.projects.length)
    };
  }

  const projectIndex = license.projects.findIndex(p => p.id.toLowerCase() === projectId.toLowerCase());

  if (projectIndex === -1) {
    return {
      success: false,
      error: 'Project not found in license.',
      slotsUsed: license.projects.length,
      slotsTotal: license.maxProjects,
      slotsRemaining: calcSlotsRemaining(license.maxProjects, license.projects.length)
    };
  }

  const removedProject = license.projects.splice(projectIndex, 1)[0];
  await saveLicense(license);

  return {
    success: true,
    removedProject,
    slotsUsed: license.projects.length,
    slotsTotal: license.maxProjects,
    slotsRemaining: calcSlotsRemaining(license.maxProjects, license.projects.length)
  };
}

/**
 * Check if a project ID is licensed
 * Returns { licensed, project, reason, registeredProjects, slotsUsed, slotsTotal, slotsRemaining }
 */
export async function isProjectIdLicensed(projectId) {
  const license = await loadLicense();

  if (!license) {
    return { licensed: false, reason: 'No license found' };
  }

  // Check expiry
  if (new Date() > new Date(license.expires)) {
    return { licensed: false, reason: 'License expired', expiredOn: license.expires };
  }

  const project = license.projects.find(p => p.id.toLowerCase() === projectId.toLowerCase());

  if (!project) {
    return {
      licensed: false,
      reason: 'Project not licensed',
      registeredProjects: license.projects.map(p => p.id),
      slotsUsed: license.projects.length,
      slotsTotal: license.maxProjects,
      slotsRemaining: calcSlotsRemaining(license.maxProjects, license.projects.length)
    };
  }

  return {
    licensed: true,
    license,
    project,
    projectId: project.id,
    registeredProjects: license.projects.map(p => p.id),
    slotsUsed: license.projects.length,
    slotsTotal: license.maxProjects,
    slotsRemaining: calcSlotsRemaining(license.maxProjects, license.projects.length)
  };
}

/**
 * Get a project by ID
 * Returns project object or null
 */
export async function getProjectById(projectId) {
  const license = await loadLicense();
  if (!license) return null;

  return license.projects.find(p => p.id.toLowerCase() === projectId.toLowerCase()) || null;
}

/**
 * Get all registered project IDs
 */
export async function getRegisteredProjects() {
  const license = await loadLicense();
  if (!license) return [];
  return license.projects;
}

/**
 * Get slot information
 */
export async function getSlotInfo() {
  const license = await loadLicense();

  if (!license) {
    return {
      hasLicense: false,
      slotsUsed: 0,
      slotsTotal: 0,
      slotsRemaining: 0
    };
  }

  return {
    hasLicense: true,
    tier: license.tier,
    tierName: license.tierName,
    slotsUsed: license.projects.length,
    slotsTotal: license.maxProjects,
    slotsRemaining: calcSlotsRemaining(license.maxProjects, license.projects.length),
    expires: license.expires,
    daysRemaining: Math.max(0, Math.ceil((new Date(license.expires) - new Date()) / (1000 * 60 * 60 * 24)))
  };
}

/**
 * Get license status summary
 */
export async function getLicenseStatus() {
  const license = await loadLicense();

  if (!license) {
    return { active: false, reason: 'No license found' };
  }

  const now = new Date();
  const expires = new Date(license.expires);
  const daysRemaining = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));

  return {
    active: daysRemaining > 0,
    licenseKey: license.licenseKey,
    orderId: license.licenseKey, // Legacy compatibility
    email: license.email,
    tier: license.tier,
    tierName: license.tierName,
    expires: license.expires,
    daysRemaining: Math.max(0, daysRemaining),
    projects: license.projects,
    projectsUsed: license.projects.length,
    projectsTotal: license.maxProjects,
    slotsRemaining: calcSlotsRemaining(license.maxProjects, license.projects.length),
    expired: daysRemaining <= 0,
    cicdEnabled: license.cicdEnabled || false
  };
}

/**
 * Legacy compatibility: Check if project is licensed by fingerprint
 * Used during migration period
 */
export async function isProjectLicensed(projectFingerprint) {
  const license = await loadLicense();

  if (!license) {
    return { licensed: false, reason: 'No license found' };
  }

  // Check expiry
  if (new Date() > new Date(license.expires)) {
    return { licensed: false, reason: 'License expired', expiredOn: license.expires };
  }

  // Try to find by legacy fingerprint (migration support)
  const project = license.projects.find(p =>
    p._legacyFingerprint === projectFingerprint ||
    p.fingerprint === projectFingerprint
  );

  if (!project) {
    return {
      licensed: false,
      reason: 'Project not licensed',
      licensedProjects: license.projects.map(p => p.id),
      slotsUsed: license.projects.length,
      slotsTotal: license.maxProjects,
      slotsRemaining: calcSlotsRemaining(license.maxProjects, license.projects.length)
    };
  }

  return {
    licensed: true,
    license,
    project
  };
}

/**
 * Legacy compatibility: Add project to license by fingerprint
 */
export async function addProjectToLicense(projectFingerprint, projectName, projectPath) {
  const license = await loadLicense();

  if (!license) {
    throw new Error('No license found. Please activate first.');
  }

  // Check if project already added (by fingerprint or name as ID)
  const existingByFingerprint = license.projects.find(p =>
    p._legacyFingerprint === projectFingerprint ||
    p.fingerprint === projectFingerprint
  );
  if (existingByFingerprint) {
    return { alreadyAdded: true, project: existingByFingerprint };
  }

  const existingById = license.projects.find(p => p.id.toLowerCase() === projectName.toLowerCase());
  if (existingById) {
    return { alreadyAdded: true, project: existingById };
  }

  // Check if slots available (skip if unlimited: -1)
  if (license.maxProjects !== -1 && license.projects.length >= license.maxProjects) {
    throw new Error(`No slots remaining. Your ${license.tierName} license allows ${license.maxProjects} project(s). Contact sales@oynk.co.uk to upgrade.`);
  }

  // Add project with new format
  const newProject = {
    id: projectName,
    activatedAt: new Date().toISOString()
  };

  license.projects.push(newProject);
  await saveLicense(license);

  return { alreadyAdded: false, project: newProject };
}

export default {
  loadLicense,
  saveLicense,
  registerProjectId,
  unregisterProjectId,
  isProjectIdLicensed,
  getProjectById,
  getRegisteredProjects,
  getSlotInfo,
  getLicenseStatus,
  // Legacy compatibility
  addProjectToLicense,
  isProjectLicensed
};
