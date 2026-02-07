/**
 * Git Platform Integrations — Facade
 *
 * CRUD for stored connections (encrypted credentials).
 * Each connection references a platform (github, gitlab, etc.)
 * and stores encrypted tokens in DATA_DIR/connections.json.
 */

import { randomBytes } from 'crypto';
import { loadConnections, saveConnections } from '../config/store.mjs';
import { DATA_DIR } from '../config/index.mjs';
import { getLicence } from '../config/store.mjs';
import { encrypt, decrypt, maskToken } from './crypto.mjs';
import { getPlatform, listPlatforms, isValidPlatform } from './platforms/registry.mjs';

function generateId() {
  return 'conn_' + randomBytes(8).toString('hex');
}

function getLicenceKey() {
  const licence = getLicence();
  return licence?.key || licence?.orderId || null;
}

/**
 * Mask credentials in a connection for API responses.
 * Returns a copy with token values replaced by masked versions.
 */
function maskConnection(conn) {
  const masked = { ...conn };
  // Don't expose raw encrypted blob either — just indicate it's stored
  masked.credentials = { stored: true };
  if (conn._decryptedCredentials) {
    // Never leak this
    delete masked._decryptedCredentials;
  }
  // Show masked token hint if we can decrypt
  try {
    const creds = decryptCredentials(conn);
    if (creds.token) masked.tokenHint = maskToken(creds.token);
    if (creds.username) masked.usernameHint = creds.username;
  } catch {
    masked.tokenHint = '***';
  }
  return masked;
}

/**
 * Decrypt the credentials for a connection
 */
function decryptCredentials(conn) {
  if (!conn.credentials?.encrypted) {
    throw new Error('No encrypted credentials found');
  }
  const json = decrypt(conn.credentials, DATA_DIR, getLicenceKey());
  return JSON.parse(json);
}

/**
 * List all supported platforms
 */
export function getSupportedPlatforms() {
  return listPlatforms();
}

/**
 * List all connections (tokens masked)
 */
export function getConnections() {
  const connections = loadConnections();
  return connections.map(maskConnection);
}

/**
 * Get a single connection by ID (tokens masked)
 */
export function getConnection(id) {
  const connections = loadConnections();
  const conn = connections.find(c => c.id === id);
  if (!conn) return null;
  return maskConnection(conn);
}

/**
 * Get a raw connection (with encrypted credentials) for internal use
 */
export function getRawConnection(id) {
  const connections = loadConnections();
  return connections.find(c => c.id === id) || null;
}

/**
 * Create a new connection
 * @param {{ platformId, label, baseUrl, credentials, username, org, region }} input
 * @returns {{ success, connection?, error? }}
 */
export function createConnection(input) {
  const { platformId, label, baseUrl, credentials, username, org, region } = input;

  if (!isValidPlatform(platformId)) {
    return { success: false, error: `Unknown platform: ${platformId}` };
  }
  if (!credentials || (!credentials.token && !credentials.profile)) {
    return { success: false, error: 'Credentials are required' };
  }

  const encryptedCreds = encrypt(JSON.stringify(credentials), DATA_DIR, getLicenceKey());

  const connection = {
    id: generateId(),
    platformId,
    label: label || getPlatform(platformId).name,
    baseUrl: baseUrl || null,
    credentials: encryptedCreds,
    username: username || null,
    org: org || null,
    region: region || null,
    createdAt: new Date().toISOString(),
    lastTestedAt: null,
    lastTestSuccess: null
  };

  const connections = loadConnections();
  connections.push(connection);
  saveConnections(connections);

  return { success: true, connection: maskConnection(connection) };
}

/**
 * Update an existing connection
 * @param {string} id - Connection ID
 * @param {object} updates - Fields to update
 */
export function updateConnection(id, updates) {
  const connections = loadConnections();
  const index = connections.findIndex(c => c.id === id);
  if (index === -1) {
    return { success: false, error: 'Connection not found' };
  }

  const conn = connections[index];

  // Update simple fields
  if (updates.label !== undefined) conn.label = updates.label;
  if (updates.baseUrl !== undefined) conn.baseUrl = updates.baseUrl;
  if (updates.username !== undefined) conn.username = updates.username;
  if (updates.org !== undefined) conn.org = updates.org;
  if (updates.region !== undefined) conn.region = updates.region;

  // Re-encrypt if credentials provided
  if (updates.credentials) {
    conn.credentials = encrypt(JSON.stringify(updates.credentials), DATA_DIR, getLicenceKey());
  }

  saveConnections(connections);
  return { success: true, connection: maskConnection(conn) };
}

/**
 * Delete a connection
 */
export function deleteConnection(id) {
  const connections = loadConnections();
  const index = connections.findIndex(c => c.id === id);
  if (index === -1) {
    return { success: false, error: 'Connection not found' };
  }
  connections.splice(index, 1);
  saveConnections(connections);
  return { success: true };
}

/**
 * Test a connection's credentials against the platform API
 */
export async function testConnection(id) {
  const connections = loadConnections();
  const conn = connections.find(c => c.id === id);
  if (!conn) {
    return { success: false, error: 'Connection not found' };
  }

  const platform = getPlatform(conn.platformId);
  if (!platform) {
    return { success: false, error: `Unknown platform: ${conn.platformId}` };
  }

  let credentials;
  try {
    credentials = decryptCredentials(conn);
  } catch (err) {
    return { success: false, error: `Decryption failed: ${err.message}` };
  }

  // Merge org/region into credentials for platforms that need them
  if (conn.org) credentials.org = conn.org;
  if (conn.region) credentials.region = conn.region;
  if (conn.username) credentials.username = credentials.username || conn.username;

  const result = await platform.testConnection(credentials, { baseUrl: conn.baseUrl });

  // Update test tracking fields
  const idx = connections.findIndex(c => c.id === id);
  connections[idx].lastTestedAt = new Date().toISOString();
  connections[idx].lastTestSuccess = result.success;
  saveConnections(connections);

  return result;
}

/**
 * List repos for a connection
 */
export async function listRepos(id, { page = 1, perPage = 25, search } = {}) {
  const conn = getRawConnection(id);
  if (!conn) return { repos: [], hasMore: false, error: 'Connection not found' };

  const platform = getPlatform(conn.platformId);
  if (!platform) return { repos: [], hasMore: false, error: 'Unknown platform' };

  let credentials;
  try {
    credentials = decryptCredentials(conn);
  } catch (err) {
    return { repos: [], hasMore: false, error: `Decryption failed: ${err.message}` };
  }

  if (conn.org) credentials.org = conn.org;
  if (conn.region) credentials.region = conn.region;
  if (conn.username) credentials.username = credentials.username || conn.username;

  return platform.listRepos(credentials, { baseUrl: conn.baseUrl, page, perPage, search });
}

/**
 * Get decrypted credentials for a connection (internal use only — for clone/feedback)
 */
export function getDecryptedCredentials(id) {
  const conn = getRawConnection(id);
  if (!conn) return null;

  try {
    const credentials = decryptCredentials(conn);
    if (conn.org) credentials.org = conn.org;
    if (conn.region) credentials.region = conn.region;
    if (conn.username) credentials.username = credentials.username || conn.username;
    return credentials;
  } catch {
    return null;
  }
}
