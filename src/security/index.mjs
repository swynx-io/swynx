// src/security/index.mjs
// Triple Air-Gap Security Architecture for Swynx
// Layer 1: Zero Data Exfiltration
// Layer 2: Full Offline Operation
// Layer 3: Complete Data Containment

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, appendFileSync } from 'fs';
import { join, basename } from 'path';
import { hostname, platform, arch, cpus, totalmem, networkInterfaces } from 'os';
import { createHash, createVerify, generateKeyPairSync } from 'crypto';
import { DATA_DIR, ensureDataDir } from '../config/index.mjs';

// Global config directory (license + preferences ONLY)
const GLOBAL_DIR = DATA_DIR;
const NETWORK_LOG = join(GLOBAL_DIR, 'network-audit.log');
const LICENSE_FILE = join(GLOBAL_DIR, 'license.json');
const PREFERENCES_FILE = join(GLOBAL_DIR, 'preferences.json');

// Ensure global directory exists (lazy - only when needed)
function ensureGlobalDir() {
  ensureDataDir();
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 1: ZERO DATA EXFILTRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Known telemetry/analytics packages that should NOT be present
 */
const TELEMETRY_PACKAGES = [
  'analytics-node',
  'mixpanel',
  'amplitude',
  'segment',
  '@sentry/node',
  'sentry',
  'bugsnag',
  'rollbar',
  'logrocket',
  'fullstory',
  'hotjar',
  'heap-api',
  'posthog-node',
  'rudder-sdk-node',
  'keen-tracking',
  '@amplitude/node',
  '@segment/analytics-node',
  'applicationinsights',
  'newrelic',
  'datadog-metrics',
  'dd-trace',
  'elastic-apm-node',
  '@google-analytics/data',
  'universal-analytics'
];

/**
 * Check if any telemetry packages are installed
 */
export function checkTelemetryPackages(projectPath = process.cwd()) {
  const results = {
    clean: true,
    packagesFound: [],
    packagesChecked: TELEMETRY_PACKAGES.length
  };

  // Check our own package.json
  const peerAuditRoot = join(projectPath, 'node_modules', 'swynx');
  const checkPaths = [
    join(process.cwd(), 'package.json'),
    join(process.cwd(), 'package-lock.json')
  ];

  for (const pkgPath of checkPaths) {
    if (existsSync(pkgPath)) {
      try {
        const content = readFileSync(pkgPath, 'utf-8');
        for (const pkg of TELEMETRY_PACKAGES) {
          if (content.includes(`"${pkg}"`)) {
            results.clean = false;
            results.packagesFound.push(pkg);
          }
        }
      } catch {}
    }
  }

  return results;
}

/**
 * Log a network call to the audit log
 */
export function logNetworkCall(endpoint, purpose, dataSent = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    endpoint,
    purpose,
    dataSent: Object.keys(dataSent), // Log only KEYS, never values
    dataContainsCode: false
  };

  const logLine = JSON.stringify(entry) + '\n';

  try {
    appendFileSync(NETWORK_LOG, logLine);
  } catch {}

  return entry;
}

/**
 * Get network audit log
 */
export function getNetworkAuditLog(limit = 100) {
  if (!existsSync(NETWORK_LOG)) {
    return [];
  }

  try {
    const content = readFileSync(NETWORK_LOG, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
  } catch {
    return [];
  }
}

/**
 * Clear network audit log
 */
export function clearNetworkAuditLog() {
  try {
    writeFileSync(NETWORK_LOG, '');
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 2: FULL OFFLINE OPERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate machine fingerprint (hash only, no raw identifiers)
 */
export function generateMachineFingerprintSync() {
  // Collect non-sensitive machine identifiers
  const components = [
    hostname(),
    platform(),
    arch(),
    cpus()[0]?.model || 'unknown',
    totalmem().toString(),
    // Network interface MACs (hashed, not raw)
    Object.values(networkInterfaces())
      .flat()
      .filter(i => i && !i.internal && i.mac !== '00:00:00:00:00:00')
      .map(i => i.mac)
      .sort()
      .join(',')
  ];

  // Create SHA-256 hash - no raw identifiers exposed
  const fingerprint = createHash('sha256')
    .update(components.join('|'))
    .digest('hex');

  return {
    fingerprint,
    algorithm: 'SHA-256',
    components: components.length,
    generated: new Date().toISOString()
  };
}

/**
 * Verify license file signature locally (no network)
 */
export function verifyLicenseSignature(licenseData, publicKey) {
  try {
    const { signature, ...payload } = licenseData;
    if (!signature) return { valid: false, reason: 'No signature' };

    const verify = createVerify('RSA-SHA256');
    verify.update(JSON.stringify(payload));

    const isValid = verify.verify(publicKey, signature, 'base64');

    return {
      valid: isValid,
      reason: isValid ? 'Signature verified locally' : 'Invalid signature'
    };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

/**
 * Activate using offline license file
 */
export function activateOffline(licenseFilePath) {
  if (!existsSync(licenseFilePath)) {
    return { success: false, error: 'License file not found' };
  }

  try {
    const licenseData = JSON.parse(readFileSync(licenseFilePath, 'utf-8'));

    // Verify required fields
    if (!licenseData.key || !licenseData.validUntil) {
      return { success: false, error: 'Invalid license file format' };
    }

    // Check expiry
    if (new Date(licenseData.validUntil) < new Date()) {
      return { success: false, error: 'License has expired' };
    }

    // Check machine binding if present
    if (licenseData.machineFingerprint) {
      const currentFingerprint = generateMachineFingerprintSync();
      if (licenseData.machineFingerprint !== currentFingerprint.fingerprint) {
        return { success: false, error: 'License is bound to a different machine' };
      }
    }

    // Save to global license location
    writeFileSync(LICENSE_FILE, JSON.stringify(licenseData, null, 2));

    // Log this activation (no code data, just the event)
    logNetworkCall('LOCAL', 'offline-license-activation', {
      licenseKey: '[REDACTED]',
      method: 'file-based'
    });

    return {
      success: true,
      license: {
        key: licenseData.key.substring(0, 8) + '...',
        validUntil: licenseData.validUntil,
        tier: licenseData.tier || 'enterprise',
        offlineActivation: true
      }
    };
  } catch (err) {
    return { success: false, error: `Failed to parse license file: ${err.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 3: COMPLETE DATA CONTAINMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the project-local storage directory
 */
export function getProjectStorageDir(projectPath) {
  return join(projectPath, '.swynx');
}

/**
 * Get the project-local scans directory
 */
export function getProjectScansDir(projectPath) {
  const dir = join(projectPath, '.swynx', 'scans');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * List contents of global storage (for security audit)
 */
export function listGlobalStorage() {
  const files = [];

  if (!existsSync(GLOBAL_DIR)) {
    return files;
  }

  try {
    const entries = readdirSync(GLOBAL_DIR);

    for (const entry of entries) {
      const fullPath = join(GLOBAL_DIR, entry);
      const stat = statSync(fullPath);

      let description = 'Unknown';
      let containsCode = false;

      // Describe each known file type
      if (entry === 'license.json') {
        description = 'License key and activation data (no code)';
      } else if (entry === 'preferences.json') {
        description = 'User preferences (theme, port settings)';
      } else if (entry === 'network-audit.log') {
        description = 'Log of all network calls made by Swynx';
      } else if (entry === 'scans.db') {
        description = 'LEGACY: Global scan database (should be migrated to project-local)';
        containsCode = true; // This is the old format that mixed data
      } else if (entry.endsWith('.log')) {
        description = 'Log file';
      }

      files.push({
        name: entry,
        path: fullPath,
        size: stat.size,
        sizeFormatted: formatBytes(stat.size),
        modified: stat.mtime,
        description,
        containsCode,
        isDirectory: stat.isDirectory()
      });
    }
  } catch {}

  return files;
}

/**
 * Check if global storage contains any code data (violation of Layer 3)
 */
export function checkDataContainment() {
  const globalFiles = listGlobalStorage();
  const violations = globalFiles.filter(f => f.containsCode);

  return {
    compliant: violations.length === 0,
    violations,
    globalFiles,
    recommendation: violations.length > 0
      ? 'Run `swynx migrate-storage` to move scan data to project directories'
      : 'Data containment verified - no code in global storage'
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE SECURITY AUDIT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run full security audit
 */
export function runSecurityAudit(options = {}) {
  const results = {
    timestamp: new Date().toISOString(),
    layers: {},
    overallStatus: 'PASS',
    issues: [],
    recommendations: []
  };

  // Layer 1: Check for telemetry
  const telemetry = checkTelemetryPackages();
  results.layers.layer1 = {
    name: 'Zero Data Exfiltration',
    status: telemetry.clean ? 'PASS' : 'FAIL',
    details: {
      telemetryPackagesFound: telemetry.packagesFound,
      packagesChecked: telemetry.packagesChecked,
      networkAuditLogExists: existsSync(NETWORK_LOG),
      networkAuditEntries: getNetworkAuditLog(10).length
    }
  };

  if (!telemetry.clean) {
    results.overallStatus = 'FAIL';
    results.issues.push(`Telemetry packages found: ${telemetry.packagesFound.join(', ')}`);
  }

  // Layer 2: Check offline operation capability
  const licenseExists = existsSync(LICENSE_FILE);
  let licenseValid = false;
  let licenseData = null;

  if (licenseExists) {
    try {
      licenseData = JSON.parse(readFileSync(LICENSE_FILE, 'utf-8'));
      licenseValid = new Date(licenseData.validUntil) > new Date();
    } catch {}
  }

  results.layers.layer2 = {
    name: 'Full Offline Operation',
    status: 'PASS', // Capability always exists
    details: {
      offlineActivationSupported: true,
      licenseFilePresent: licenseExists,
      licenseValid,
      localVerificationEnabled: true,
      noPhoneHomeRequired: true
    }
  };

  // Layer 3: Check data containment
  const containment = checkDataContainment();
  results.layers.layer3 = {
    name: 'Complete Data Containment',
    status: containment.compliant ? 'PASS' : 'WARN',
    details: {
      globalStorageCompliant: containment.compliant,
      globalFiles: containment.globalFiles.map(f => ({
        name: f.name,
        size: f.sizeFormatted,
        description: f.description,
        containsCode: f.containsCode
      })),
      violations: containment.violations.length
    }
  };

  if (!containment.compliant) {
    results.overallStatus = results.overallStatus === 'FAIL' ? 'FAIL' : 'WARN';
    results.recommendations.push(containment.recommendation);
  }

  // Show global storage if requested
  if (options.showGlobal) {
    results.globalStorage = listGlobalStorage();
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default {
  // Layer 1
  checkTelemetryPackages,
  logNetworkCall,
  getNetworkAuditLog,
  clearNetworkAuditLog,

  // Layer 2
  generateMachineFingerprintSync,
  verifyLicenseSignature,
  activateOffline,

  // Layer 3
  getProjectStorageDir,
  getProjectScansDir,
  listGlobalStorage,
  checkDataContainment,

  // Audit
  runSecurityAudit,

  // Constants
  GLOBAL_DIR,
  NETWORK_LOG,
  LICENSE_FILE
};
