/**
 * Project Registry
 *
 * Manages registered projects for the dashboard-first architecture.
 * Projects are identified by user-chosen IDs stored in central license.
 *
 * Capabilities:
 * - Register new projects (if slots available)
 * - Unregister projects (releases slot for reuse)
 * - Rename project display names
 *
 * Storage:
 * - Central license store: DATA_DIR/licenses.json (project IDs, slots)
 * - Local project registry: DATA_DIR/projects.json (path mappings for dashboard)
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import {
  loadLicense,
  registerProjectId,
  unregisterProjectId,
  isProjectIdLicensed,
  getProjectById,
  getSlotInfo as getLicenseSlotInfo
} from '../license/storage.mjs';
import { getProjectDetails } from '../license/fingerprint.mjs';
import { getProjectId, setProjectId } from '../config/index.mjs';
import { DATA_DIR } from '../config/index.mjs';

const PROJECTS_FILE = join(DATA_DIR, 'projects.json');

/**
 * Local project record structure (for dashboard):
 * {
 *   id: "my-ecommerce-api",       // Project ID (matches license store)
 *   path: "/Users/john/my-app",   // Full local path
 *   pathHash: "sha256:...",       // Hashed path for privacy
 *   name: "my-app",               // Display name
 *   addedAt: "2026-01-29T...",    // When project was added to dashboard
 *   lastScanAt: "2026-01-29T...", // When last scanned (null if never)
 *   slotNumber: 1                 // Display order (1-based)
 * }
 */

/**
 * Hash a path for privacy
 */
function hashPath(path) {
  return 'sha256:' + createHash('sha256').update(path).digest('hex').substring(0, 16);
}

/**
 * Load local project registry
 */
export async function loadProjects() {
  if (!existsSync(PROJECTS_FILE)) {
    return [];
  }

  try {
    const content = await readFile(PROJECTS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading projects file:', error.message);
    return [];
  }
}

/**
 * Save local project registry
 */
async function saveProjects(projects) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

/**
 * Get slot usage information
 */
export async function getSlotInfo() {
  return getLicenseSlotInfo();
}

/**
 * Register a new project
 *
 * @param {string} projectPath - Full path to project
 * @param {string} projectIdOverride - Optional custom project ID
 * @param {string} projectNameOverride - Optional custom display name
 * @returns {Object} - { success, project, error }
 */
export async function registerProject(projectPath, projectIdOverride = null, projectNameOverride = null) {
  // Load license
  const license = await loadLicense();

  if (!license) {
    return {
      success: false,
      error: 'No license found. Please activate a license first.',
      code: 'NO_LICENSE'
    };
  }

  // Check license expiration
  if (new Date() > new Date(license.expires)) {
    return {
      success: false,
      error: 'License has expired. Please renew your license.',
      code: 'LICENSE_EXPIRED'
    };
  }

  // Get project details
  let details;
  try {
    details = await getProjectDetails(projectPath);
  } catch (error) {
    details = { name: basename(projectPath) };
  }

  // Check if already has a projectId in .swynx.json
  const existingProjectId = await getProjectId(projectPath);

  // Determine the project ID to use
  const projectId = projectIdOverride || existingProjectId || details.name;

  // Load local project registry
  const projects = await loadProjects();

  // Check if this path is already registered locally
  const existingByPath = projects.find(p => p.path === projectPath);
  if (existingByPath) {
    // Check if it's licensed
    const licensed = await isProjectIdLicensed(existingByPath.id);
    if (licensed.licensed) {
      return {
        success: true,
        project: existingByPath,
        alreadyRegistered: true,
        slotsUsed: licensed.slotsUsed,
        slotsTotal: licensed.slotsTotal
      };
    }
    // Not licensed - need to re-register
  }

  // Register the project ID in central license store
  const regResult = await registerProjectId(projectId);

  if (!regResult.success) {
    return {
      success: false,
      error: regResult.error,
      code: regResult.slotsRemaining === 0 ? 'NO_SLOTS' : 'REGISTRATION_FAILED',
      slotsUsed: regResult.slotsUsed,
      slotsTotal: regResult.slotsTotal,
      registeredProjects: regResult.registeredProjects
    };
  }

  // Create/update .swynx.json in project directory
  try {
    await setProjectId(projectPath, regResult.project.id);
  } catch (error) {
    console.warn(`Could not write .swynx.json: ${error.message}`);
  }

  // Create local project record for dashboard
  // Use custom name if provided, otherwise folder name
  const newProject = {
    id: regResult.project.id,
    path: projectPath,
    pathHash: hashPath(projectPath),
    name: projectNameOverride || basename(projectPath),
    addedAt: new Date().toISOString(),
    lastScanAt: null,
    slotNumber: projects.length + 1
  };

  // Check if we need to update existing or add new
  const existingIndex = projects.findIndex(p => p.path === projectPath || p.id === regResult.project.id);
  if (existingIndex >= 0) {
    projects[existingIndex] = { ...projects[existingIndex], ...newProject };
  } else {
    projects.push(newProject);
  }

  await saveProjects(projects);

  return {
    success: true,
    project: newProject,
    alreadyRegistered: regResult.alreadyRegistered,
    slotsUsed: regResult.slotsUsed,
    slotsTotal: regResult.slotsTotal
  };
}

/**
 * Get a specific project by ID
 */
export async function getProject(projectId) {
  const projects = await loadProjects();
  return projects.find(p => p.id === projectId) || null;
}

/**
 * Get a project by path
 */
export async function getProjectByPath(projectPath) {
  const projects = await loadProjects();
  return projects.find(p => p.path === projectPath) || null;
}

/**
 * Update project's last scan time
 */
export async function updateProjectScanTime(projectPath) {
  const projects = await loadProjects();
  const project = projects.find(p => p.path === projectPath);

  if (project) {
    project.lastScanAt = new Date().toISOString();
    await saveProjects(projects);
  }

  return project;
}

/**
 * Rename a project
 */
export async function renameProject(projectId, newName) {
  if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
    return { success: false, error: 'Name cannot be empty' };
  }

  const projects = await loadProjects();
  const project = projects.find(p => p.id === projectId);

  if (!project) {
    return { success: false, error: 'Project not found' };
  }

  project.name = newName.trim();
  await saveProjects(projects);

  return { success: true, project };
}

/**
 * Unregister a project (remove from license and local registry)
 *
 * @param {string} projectId - Project ID to remove
 * @returns {Object} - { success, removedProject, error, slotsUsed, slotsTotal }
 */
export async function unregisterProject(projectId) {
  // Remove from license store first
  const licenseResult = await unregisterProjectId(projectId);

  if (!licenseResult.success) {
    return licenseResult;
  }

  // Remove from local project registry
  const projects = await loadProjects();
  const projectIndex = projects.findIndex(p => p.id.toLowerCase() === projectId.toLowerCase());

  if (projectIndex !== -1) {
    projects.splice(projectIndex, 1);
    // Renumber remaining slots
    projects.forEach((p, i) => {
      p.slotNumber = i + 1;
    });
    await saveProjects(projects);
  }

  return {
    success: true,
    removedProject: licenseResult.removedProject,
    slotsUsed: licenseResult.slotsUsed,
    slotsTotal: licenseResult.slotsTotal,
    slotsRemaining: licenseResult.slotsRemaining
  };
}

/**
 * Check if a project is registered (has valid license)
 */
export async function isProjectRegistered(projectPath) {
  // First check local registry
  const projects = await loadProjects();
  const localProject = projects.find(p => p.path === projectPath);

  if (!localProject) {
    // Check if .swynx.json exists with a projectId
    const projectId = await getProjectId(projectPath);
    if (projectId) {
      const licensed = await isProjectIdLicensed(projectId);
      return licensed.licensed;
    }
    return false;
  }

  // Verify it's still licensed
  const licensed = await isProjectIdLicensed(localProject.id);
  return licensed.licensed;
}

/**
 * Sync local registry with license store
 * Ensures local registry matches what's in the license
 */
export async function syncWithLicense() {
  const license = await loadLicense();
  const projects = await loadProjects();

  if (!license) {
    // No license, clear all projects
    if (projects.length > 0) {
      await saveProjects([]);
    }
    return { synced: true, cleared: true };
  }

  // Get licensed project IDs
  const licensedIds = new Set(license.projects?.map(p => p.id.toLowerCase()) || []);

  // Filter out projects not in license
  const validProjects = projects.filter(p => licensedIds.has(p.id.toLowerCase()));

  if (validProjects.length !== projects.length) {
    // Renumber slots
    validProjects.forEach((p, i) => {
      p.slotNumber = i + 1;
    });
    await saveProjects(validProjects);
    return { synced: true, removed: projects.length - validProjects.length };
  }

  return { synced: true };
}

/**
 * Get all registered projects with slot info
 */
export async function getRegisteredProjects() {
  // Sync with license first
  await syncWithLicense();

  const projects = await loadProjects();
  const slotInfo = await getSlotInfo();

  return {
    projects,
    ...slotInfo
  };
}

export default {
  loadProjects,
  getSlotInfo,
  registerProject,
  unregisterProject,
  getProject,
  getProjectByPath,
  updateProjectScanTime,
  isProjectRegistered,
  syncWithLicense,
  getRegisteredProjects
};
