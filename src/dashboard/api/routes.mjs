// src/dashboard/api/routes.mjs - Swynx API routes

import { Router } from 'express';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Simple file-based storage for scans
const DATA_DIR = join(homedir(), '.swynx');
const SCANS_FILE = join(DATA_DIR, 'scans.json');
const PROJECTS_FILE = join(DATA_DIR, 'projects.json');
const LICENSE_FILE = join(DATA_DIR, 'license.json');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache
let scansCache = null;
let projectsCache = null;
let currentScan = null;

function loadScans() {
  if (scansCache) return scansCache;
  try {
    if (existsSync(SCANS_FILE)) {
      scansCache = JSON.parse(readFileSync(SCANS_FILE, 'utf8'));
    } else {
      scansCache = [];
    }
  } catch {
    scansCache = [];
  }
  return scansCache;
}

function saveScans() {
  writeFileSync(SCANS_FILE, JSON.stringify(scansCache, null, 2));
}

function loadProjects() {
  if (projectsCache) return projectsCache;
  try {
    if (existsSync(PROJECTS_FILE)) {
      projectsCache = JSON.parse(readFileSync(PROJECTS_FILE, 'utf8'));
    } else {
      projectsCache = [];
    }
  } catch {
    projectsCache = [];
  }
  return projectsCache;
}

function saveProjects() {
  writeFileSync(PROJECTS_FILE, JSON.stringify(projectsCache, null, 2));
}

/**
 * Create API routes
 */
export async function createRoutes() {
  const router = Router();

  // Health check
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // === Projects ===

  router.get('/projects', (req, res) => {
    const projects = loadProjects();
    res.json({ success: true, projects });
  });

  router.get('/projects/registered', (req, res) => {
    const projects = loadProjects();
    const stored = getLicense();
    const hasLicense = stored && stored.key && parseLicenseKey(stored.key);
    res.json({
      success: true,
      projects,
      hasLicense: !!hasLicense,
      tier: hasLicense ? hasLicense.tier : 'open-source',
      tierName: hasLicense ? (hasLicense.tier === 'enterprise' ? 'Enterprise' : 'Trial') : 'Open Source',
      slotsUsed: projects.length,
      slotsTotal: 999, // Unlimited in swynx
      slotsRemaining: 999 - projects.length
    });
  });

  router.get('/projects/slots', (req, res) => {
    const projects = loadProjects();
    res.json({
      success: true,
      slotsUsed: projects.length,
      slotsTotal: 999,
      slotsRemaining: 999 - projects.length
    });
  });

  router.post('/projects/register', (req, res) => {
    const { projectPath, projectName } = req.body;

    if (!projectPath || !existsSync(projectPath)) {
      return res.status(400).json({
        success: false,
        error: 'Valid projectPath is required'
      });
    }

    const projects = loadProjects();
    const existing = projects.find(p => p.path === projectPath);

    if (existing) {
      return res.json({
        success: true,
        project: existing,
        alreadyRegistered: true
      });
    }

    const project = {
      id: Date.now().toString(),
      path: projectPath,
      name: projectName || basename(projectPath),
      registeredAt: new Date().toISOString()
    };

    projects.push(project);
    projectsCache = projects;
    saveProjects();

    res.json({
      success: true,
      project,
      alreadyRegistered: false
    });
  });

  router.delete('/projects/registered/:projectId', (req, res) => {
    const { projectId } = req.params;
    const projects = loadProjects();
    const idx = projects.findIndex(p => p.id === projectId);

    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    const removed = projects.splice(idx, 1)[0];
    projectsCache = projects;
    saveProjects();

    res.json({ success: true, removedProject: removed });
  });

  // === Scans ===

  router.get('/scans', (req, res) => {
    const scans = loadScans();
    res.json({ success: true, scans: scans.slice(-50) }); // Last 50
  });

  router.get('/scans/recent', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const scans = loadScans();
    res.json({ success: true, scans: scans.slice(-limit) });
  });

  router.get('/scans/latest', (req, res) => {
    const { projectPath } = req.query;
    const scans = loadScans();

    if (projectPath) {
      const projectScans = scans.filter(s => s.projectPath === projectPath);
      const latest = projectScans[projectScans.length - 1];
      return res.json({ success: true, scan: latest || null });
    }

    const latest = scans[scans.length - 1];
    res.json({ success: true, scan: latest || null });
  });

  router.get('/scans/:id', (req, res) => {
    const scans = loadScans();
    const scan = scans.find(s => s.id === req.params.id);
    if (!scan) {
      return res.status(404).json({ success: false, error: 'Scan not found' });
    }
    res.json({ success: true, scan });
  });

  // Current scan status
  router.get('/scan/status', (req, res) => {
    res.json({
      success: true,
      scanning: !!currentScan,
      progress: currentScan?.progress || null,
      projectPath: currentScan?.projectPath || null
    });
  });

  // Start a scan
  router.post('/scan', async (req, res) => {
    const { projectPath } = req.body;

    if (!projectPath || !existsSync(projectPath)) {
      return res.status(400).json({
        success: false,
        error: 'Valid projectPath is required'
      });
    }

    if (currentScan) {
      return res.status(409).json({
        success: false,
        error: 'A scan is already in progress'
      });
    }

    currentScan = {
      projectPath,
      progress: { phase: 'starting', message: 'Initializing scan...' }
    };

    // Run scan in background
    (async () => {
      try {
        const { scan } = await import('../../scanner/index.mjs');

        const result = await scan(projectPath, {
          onProgress: (progress) => {
            if (currentScan) {
              currentScan.progress = progress;
            }
          }
        });

        // Transform to reporter shape
        const scanData = {
          id: Date.now().toString(),
          projectPath,
          projectName: basename(projectPath),
          scannedAt: new Date().toISOString(),
          totalFiles: result.summary.totalFiles,
          entryPoints: result.summary.entryPoints,
          reachableFiles: result.summary.reachableFiles,
          deadRate: result.summary.deadRate,
          totalDeadBytes: result.summary.totalDeadBytes,
          languages: result.summary.languages,
          deadFiles: result.deadFiles.map(f => ({
            path: f.file,
            size: f.size,
            lines: f.lines,
            language: f.language,
            exports: (f.exports || []).map(e => e.name)
          }))
        };

        // Save scan
        const scans = loadScans();
        scans.push(scanData);
        scansCache = scans;
        saveScans();

        currentScan = null;
      } catch (error) {
        console.error('Scan error:', error);
        currentScan = null;
      }
    })();

    res.json({ success: true, message: 'Scan started' });
  });

  // === AI Qualification ===

  router.get('/ai/status', async (req, res) => {
    try {
      const { getOllamaStatus } = await import('../../ai/ollama.mjs');
      const status = await getOllamaStatus();
      res.json({ success: true, ...status });
    } catch (error) {
      res.json({
        success: true,
        available: false,
        error: error.message
      });
    }
  });

  router.post('/ai/warm', async (req, res) => {
    try {
      const { warmModel } = await import('../../ai/ollama.mjs');
      await warmModel();
      res.json({ success: true, message: 'Model warmed' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/ai/qualify', async (req, res) => {
    const { deadFiles, projectPath, scanId } = req.body;

    if (!deadFiles || !Array.isArray(deadFiles)) {
      return res.status(400).json({
        success: false,
        error: 'deadFiles array is required'
      });
    }

    try {
      const { qualify } = await import('../../ai/qualifier.mjs');
      const { loadKnowledge } = await import('../../knowledge/loader.mjs');

      const knowledge = await loadKnowledge();

      const results = {
        deadFiles,
        totalFiles: deadFiles.length
      };

      const qualified = await qualify(results, { projectPath }, {
        qualifyLimit: 50,
        verbose: false,
        knowledge
      });

      // Update scan with qualifications if scanId provided
      if (scanId) {
        const scans = loadScans();
        const scan = scans.find(s => s.id === scanId);
        if (scan) {
          scan.deadFiles = qualified.deadFiles;
          scan.qualified = true;
          scan.qualifiedAt = new Date().toISOString();
          saveScans();
        }
      }

      res.json({
        success: true,
        deadFiles: qualified.deadFiles
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Streaming AI qualification
  router.get('/ai/qualify/stream', async (req, res) => {
    const { scanId } = req.query;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    if (!scanId) {
      send('error', { error: 'scanId is required' });
      return res.end();
    }

    const scans = loadScans();
    const scan = scans.find(s => s.id === scanId);

    if (!scan) {
      send('error', { error: 'Scan not found' });
      return res.end();
    }

    const deadFiles = scan.deadFiles || [];
    if (deadFiles.length === 0) {
      send('complete', { message: 'No dead files to qualify' });
      return res.end();
    }

    try {
      const { qualifyFile } = await import('../../ai/qualifier.mjs');
      const { loadKnowledge } = await import('../../knowledge/loader.mjs');

      await loadKnowledge();

      send('start', { total: deadFiles.length });

      for (let i = 0; i < deadFiles.length && i < 50; i++) {
        const file = deadFiles[i];
        send('progress', {
          current: i + 1,
          total: Math.min(deadFiles.length, 50),
          file: file.path
        });

        try {
          const result = await qualifyFile(file, { projectPath: scan.projectPath });
          deadFiles[i] = { ...file, ...result };
          send('qualified', { index: i, result });
        } catch (err) {
          send('error', { index: i, error: err.message });
        }
      }

      // Save results
      scan.deadFiles = deadFiles;
      scan.qualified = true;
      scan.qualifiedAt = new Date().toISOString();
      saveScans();

      send('complete', { message: 'Qualification complete' });
    } catch (error) {
      send('error', { error: error.message });
    }

    res.end();
  });

  // Streaming AI qualification via POST (for frontend)
  router.post('/ai/qualify/stream', async (req, res) => {
    const { projectPath, deadFiles, totalFiles, limit = 50 } = req.body;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    if (!deadFiles || !Array.isArray(deadFiles) || deadFiles.length === 0) {
      send('complete', { message: 'No dead files to qualify' });
      return res.end();
    }

    try {
      const { qualifyFile } = await import('../../ai/qualifier.mjs');
      const { loadKnowledge } = await import('../../knowledge/loader.mjs');

      await loadKnowledge();

      send('start', { total: deadFiles.length });

      const results = [];
      const maxFiles = Math.min(deadFiles.length, limit);

      for (let i = 0; i < maxFiles; i++) {
        const file = deadFiles[i];
        send('progress', {
          current: i + 1,
          total: maxFiles,
          file: file.path
        });

        try {
          const result = await qualifyFile(file, { projectPath });
          results.push({ ...file, ...result });
          send('qualified', { index: i, result });
        } catch (err) {
          send('error', { index: i, error: err.message });
          results.push({ ...file, error: err.message });
        }
      }

      send('complete', { message: 'Qualification complete', results });
    } catch (error) {
      send('error', { error: error.message });
    }

    res.end();
  });

  // === Settings (minimal) ===

  router.get('/settings', (req, res) => {
    res.json({
      success: true,
      settings: {
        aiModel: 'qwen2.5-coder:3b',
        ollamaUrl: 'http://localhost:11434'
      }
    });
  });

  // === License ===

  function getLicense() {
    try {
      if (existsSync(LICENSE_FILE)) {
        return JSON.parse(readFileSync(LICENSE_FILE, 'utf-8'));
      }
    } catch (e) {}
    return null;
  }

  function saveLicense(license) {
    writeFileSync(LICENSE_FILE, JSON.stringify(license, null, 2));
  }

  function parseLicenseKey(key) {
    // Format: PREFIX-XXXX-XXXX-XXXX-XXXX (case-insensitive)
    if (!key || typeof key !== 'string') return null;
    const normalized = key.trim().toUpperCase();
    const match = normalized.match(/^(SWYX|TRIAL)-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/);
    if (!match) return null;
    const prefix = match[1];
    return {
      valid: true,
      type: prefix === 'TRIAL' ? 'trial' : 'enterprise',
      tier: prefix === 'TRIAL' ? 'trial' : 'enterprise',
      features: ['unlimited-projects', 'ai-qualification', 'priority-support']
    };
  }

  router.get('/license', (req, res) => {
    const stored = getLicense();
    if (stored && stored.key) {
      const parsed = parseLicenseKey(stored.key);
      if (parsed) {
        res.json({
          success: true,
          license: { ...parsed, key: stored.key, activatedAt: stored.activatedAt }
        });
        return;
      }
    }
    // Default: open-source mode
    res.json({
      success: true,
      license: {
        valid: true,
        type: 'open-source',
        features: ['unlimited-projects', 'ai-qualification']
      }
    });
  });

  router.get('/license/status', (req, res) => {
    const stored = getLicense();
    if (stored && stored.key) {
      const parsed = parseLicenseKey(stored.key);
      if (parsed) {
        // Return format expected by frontend
        res.json({
          success: true,
          active: true,
          tier: parsed.tier,
          tierName: parsed.tier === 'enterprise' ? 'Enterprise' : parsed.tier === 'trial' ? 'Trial' : 'Open Source',
          features: parsed.features,
          expires: null, // No expiry for local activation
          daysRemaining: null,
          expired: false
        });
        return;
      }
    }
    res.json({ success: true, active: false, tier: 'open-source', tierName: 'Open Source' });
  });

  router.post('/license/activate', (req, res) => {
    const { key, licenseKey } = req.body || {};
    const licenseKeyValue = key || licenseKey;
    if (!licenseKeyValue) {
      return res.status(400).json({ success: false, error: 'License key required' });
    }

    const parsed = parseLicenseKey(licenseKeyValue);
    if (!parsed) {
      return res.status(400).json({ success: false, error: 'Invalid license key format' });
    }

    const license = {
      key: licenseKeyValue,
      activatedAt: new Date().toISOString(),
      ...parsed
    };
    saveLicense(license);

    res.json({ success: true, license });
  });

  router.post('/license/deactivate', (req, res) => {
    if (existsSync(LICENSE_FILE)) {
      unlinkSync(LICENSE_FILE);
    }
    res.json({ success: true, message: 'License deactivated' });
  });

  // === System Info ===

  router.get('/system/info', async (req, res) => {
    const os = await import('os');
    res.json({
      success: true,
      cpus: os.availableParallelism?.() || 4,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem()
    });
  });

  // === Version ===

  router.get('/version', (req, res) => {
    res.json({
      success: true,
      version: '0.1.0',
      name: 'Swynx'
    });
  });

  return router;
}
