/**
 * Platform Registry
 *
 * Central registry for all supported Git platform integrations.
 * Each platform module exports a standard interface.
 */

import github from './github.mjs';
import gitlab from './gitlab.mjs';
import bitbucket from './bitbucket.mjs';
import azureDevops from './azure-devops.mjs';
import codecommit from './codecommit.mjs';
import gitea from './gitea.mjs';
import forgejo from './forgejo.mjs';
import perforce from './perforce.mjs';

const platforms = new Map();

function register(platform) {
  platforms.set(platform.id, platform);
}

register(github);
register(gitlab);
register(bitbucket);
register(azureDevops);
register(codecommit);
register(gitea);
register(forgejo);
register(perforce);

/**
 * Get a platform by ID
 * @param {string} id - Platform identifier (e.g. 'github', 'gitlab')
 * @returns {object|null} Platform module or null
 */
export function getPlatform(id) {
  return platforms.get(id) || null;
}

/**
 * List all registered platforms with their credential field schemas
 * @returns {Array<{ id, name, credentialFields }>}
 */
export function listPlatforms() {
  return Array.from(platforms.values()).map(p => ({
    id: p.id,
    name: p.name,
    credentialFields: p.credentialFields
  }));
}

/**
 * Check if a platform ID is valid
 */
export function isValidPlatform(id) {
  return platforms.has(id);
}
