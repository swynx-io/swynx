// src/dashboard/api/routes.mjs
// API routes for Codebase Audit Dashboard

import { Router } from 'express';
import { scanProject } from '../../scanner/index.mjs';
import {
  initDatabase,
  saveScan,
  getRecentScans,
  getScanById,
  getAllScans,
  getProjects,
  getProjectStats,
  getProjectConfigFromDb,
  saveProjectConfigToDb
} from '../../storage/index.mjs';
import {
  listModules,
  getFixStatus,
  previewModule,
  applyFix
} from '../../fixer/index.mjs';
import {
  listSessions,
  restoreSession,
  purgeSession
} from '../../fixer/quarantine.mjs';
import {
  checkProjectLicense,
  getLicenseStatus
} from '../../license/index.mjs';
import {
  loadConfig,
  saveProjectConfig,
  DEFAULT_COSTS
} from '../../config/index.mjs';
import {
  loadProjects,
  getSlotInfo,
  registerProject,
  unregisterProject,
  getProject,
  getProjectByPath,
  updateProjectScanTime,
  isProjectRegistered,
  getRegisteredProjects
} from '../../projects/index.mjs';
import { activateLicense } from '../../license/activation.mjs';
import { loadLicense, saveLicense } from '../../license/storage.mjs';
import { VERSION, checkForUpdate, getVersionInfo, installUpdate } from '../../cli/commands/update.mjs';
import { getSettings, saveSettings, getSetting } from '../../config/store.mjs';
import { availableParallelism, totalmem, freemem } from 'os';
import { readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import {
  generateReport,
  generateDiffReport,
  getContentType,
  getFileExtension
} from '../../reports/index.mjs';
import {
  generateESGReport,
  getDatePresets,
  logESGExport
} from '../../reports/esg/index.mjs';

/**
 * Create API routes
 */
export async function createRoutes() {
  const router = Router();

  // Initialize database on startup
  await initDatabase();

  // Health check
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // === Projects ===

  // List all projects (from scan history)
  router.get('/projects', async (req, res) => {
    try {
      const projects = await getProjects();
      res.json({ success: true, projects });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === Registered Projects (Dashboard-First) ===

  // Get all registered projects with slot info
  router.get('/projects/registered', async (req, res) => {
    try {
      const data = await getRegisteredProjects();
      res.json({ success: true, ...data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get slot usage info
  router.get('/projects/slots', async (req, res) => {
    try {
      const slotInfo = await getSlotInfo();
      res.json({ success: true, ...slotInfo });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Register a new project (uses a slot)
  router.post('/projects/register', async (req, res) => {
    try {
      const { projectPath, projectName } = req.body;

      if (!projectPath) {
        return res.status(400).json({
          success: false,
          error: 'projectPath is required'
        });
      }

      const result = await registerProject(projectPath, null, projectName);

      if (!result.success) {
        return res.status(result.code === 'NO_SLOTS' ? 403 : 400).json({
          success: false,
          error: result.error,
          code: result.code,
          slotsUsed: result.slotsUsed,
          slotsTotal: result.slotsTotal
        });
      }

      res.json({
        success: true,
        project: result.project,
        alreadyRegistered: result.alreadyRegistered,
        slotsUsed: result.slotsUsed,
        slotsTotal: result.slotsTotal
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Unregister a project (release a slot)
  router.delete('/projects/registered/:projectId', async (req, res) => {
    try {
      const { projectId } = req.params;

      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: 'projectId is required'
        });
      }

      const result = await unregisterProject(projectId);

      if (!result.success) {
        return res.status(404).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        removedProject: result.removedProject,
        slotsUsed: result.slotsUsed,
        slotsTotal: result.slotsTotal,
        slotsRemaining: result.slotsRemaining
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Check if a project is registered
  router.get('/projects/check/:projectPath(*)', async (req, res) => {
    try {
      const projectPath = decodeURIComponent(req.params.projectPath);
      const registered = await isProjectRegistered(projectPath);
      const project = registered ? await getProjectByPath(projectPath) : null;

      res.json({
        success: true,
        registered,
        project
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get file tree for a project (to confirm correct project)
  router.get('/projects/files/:projectPath(*)', async (req, res) => {
    try {
      const projectPath = decodeURIComponent(req.params.projectPath);
      const depth = parseInt(req.query.depth) || 2;
      const maxFiles = parseInt(req.query.maxFiles) || 100;

      if (!existsSync(projectPath)) {
        return res.status(404).json({
          success: false,
          error: 'Project path does not exist'
        });
      }

      // Build file tree with limited depth
      let fileCount = 0;
      const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'vendor', '.swynx'];

      function buildTree(dir, currentDepth = 0) {
        if (currentDepth > depth || fileCount > maxFiles) {
          return null;
        }

        const items = [];
        try {
          const entries = readdirSync(dir);

          for (const entry of entries) {
            if (fileCount > maxFiles) break;

            const fullPath = join(dir, entry);
            const isIgnored = ignoreDirs.includes(entry);

            try {
              const stat = statSync(fullPath);
              const isDir = stat.isDirectory();

              if (isDir) {
                const children = isIgnored ? null : buildTree(fullPath, currentDepth + 1);
                items.push({
                  name: entry,
                  type: 'directory',
                  collapsed: isIgnored,
                  children: children || []
                });
              } else {
                fileCount++;
                items.push({
                  name: entry,
                  type: 'file',
                  size: stat.size
                });
              }
            } catch (e) {
              // Skip files we can't read
            }
          }
        } catch (e) {
          // Can't read directory
        }

        // Sort: directories first, then files, alphabetically
        items.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        return items;
      }

      const tree = buildTree(projectPath);

      res.json({
        success: true,
        path: projectPath,
        name: basename(projectPath),
        tree,
        truncated: fileCount > maxFiles
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === Reports ===

  // Generate action list report from a scan
  router.get('/report/action-list/:scanId', async (req, res) => {
    try {
      const { scanId } = req.params;
      const format = req.query.format || 'json';

      const scan = await getScanById(scanId, { includeRaw: true });
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      // Parse raw_data JSON string into raw object for report generation
      if (scan.raw_data && typeof scan.raw_data === 'string') {
        try {
          scan.raw = JSON.parse(scan.raw_data);
        } catch (e) {
          console.error('Failed to parse raw_data:', e.message);
        }
      }

      const projectInfo = {
        name: scan.project_name || basename(scan.project_path),
        path: scan.project_path
      };

      const report = generateReport(scan, { format, projectInfo });

      if (format === 'json') {
        return res.json({ success: true, ...report });
      }

      // Set headers for download
      const contentType = getContentType(format);
      const ext = getFileExtension(format);
      const filename = `action-list-${scanId}.${ext}`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(report);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Generate progress report (diff between scans)
  router.get('/report/progress', async (req, res) => {
    try {
      const { from, to, format = 'json' } = req.query;

      if (!to) {
        return res.status(400).json({ success: false, error: 'to scan ID required' });
      }

      // Get the "to" scan
      const toScan = await getScanById(to, { includeRaw: true });
      if (!toScan) {
        return res.status(404).json({ success: false, error: 'Target scan not found' });
      }

      // Get the "from" scan
      let fromScan;
      if (from === 'previous' || !from) {
        // Get the scan before "to" for this project
        const scans = await getRecentScans(toScan.project_path, 2, { includeRaw: true });
        fromScan = scans.find(s => s.id !== to);
        if (!fromScan) {
          return res.status(400).json({
            success: false,
            error: 'No previous scan found for comparison'
          });
        }
      } else {
        fromScan = await getScanById(from, { includeRaw: true });
        if (!fromScan) {
          return res.status(404).json({ success: false, error: 'From scan not found' });
        }
      }

      const report = generateDiffReport(fromScan, toScan, { format });

      if (format === 'json') {
        return res.json({ success: true, ...report });
      }

      // Set headers for download
      const contentType = getContentType(format);
      const ext = getFileExtension(format);
      const filename = `progress-${from || 'previous'}-to-${to}.${ext}`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(report);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // List scans available for diffing
  router.get('/report/scans/:projectPath(*)', async (req, res) => {
    try {
      const projectPath = decodeURIComponent(req.params.projectPath);
      const limit = parseInt(req.query.limit) || 20;

      const scans = await getRecentScans(projectPath, limit, { includeRaw: false });

      const scanList = scans.map((scan, idx) => ({
        id: scan.id,
        date: scan.created_at || scan.scannedAt,
        healthScore: scan.health_score || scan.healthScore || scan.score,
        isLatest: idx === 0
      }));

      res.json({ success: true, scans: scanList, projectPath });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === ESG Reports ===

  // Get date presets for ESG reports
  router.get('/report/esg/presets', (req, res) => {
    try {
      const presets = getDatePresets();
      res.json({ success: true, presets });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Generate ESG compliance report
  router.get('/report/esg', async (req, res) => {
    try {
      const {
        format = 'pdf',
        period,
        after,
        before,
        projects
      } = req.query;

      // Parse projects if provided as comma-separated
      const projectList = projects ? projects.split(',').map(p => p.trim()) : undefined;

      const result = await generateESGReport({
        format,
        period,
        after,
        before,
        projects: projectList
      });

      // Log the export
      await logESGExport(result.reportData, format);

      if (format === 'json') {
        return res.json({
          success: true,
          report: result.reportData
        });
      }

      // Send file download
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);

      if (Buffer.isBuffer(result.data)) {
        return res.send(result.data);
      }

      return res.send(result.data);
    } catch (error) {
      console.error('[ESG Report Error]', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === Scans ===

  // Get all scans (with optional filter)
  router.get('/scans', async (req, res) => {
    try {
      const { project, limit, includeRaw } = req.query;
      const scans = await getAllScans({
        projectPath: project,
        limit: limit ? parseInt(limit, 10) : 20,
        includeRaw: includeRaw === '1' || includeRaw === 'true'
      });
      res.json({ success: true, scans });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get latest scan for a project
  router.get('/scans/latest/:projectPath(*)', async (req, res) => {
    try {
      const projectPath = decodeURIComponent(req.params.projectPath);
      const includeRaw = req.query.includeRaw === '1' || req.query.includeRaw === 'true';
      const scans = await getRecentScans(projectPath, 1, { includeRaw });
      if (scans.length === 0) {
        return res.json({ success: true, scan: null });
      }
      res.json({ success: true, scan: scans[0] });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get scan by ID
  router.get('/scans/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }
      res.json({ success: true, scan });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Run a new scan (simple POST - for backwards compatibility)
  router.post('/scan', async (req, res) => {
    try {
      const { projectPath, config } = req.body;
      if (!projectPath) {
        return res.status(400).json({ success: false, error: 'projectPath is required' });
      }

      const scanResult = await scanProject(projectPath, config || {});

      // Transform Swynx scanner output to storage format
      const result = {
        id: Date.now().toString(),
        projectPath,
        projectName: projectPath.split('/').pop(),
        scannedAt: new Date().toISOString(),
        duration: 0,
        healthScore: { score: Math.round(100 - parseFloat(scanResult.summary?.deadRate || '0')) },
        summary: {
          wastePercent: parseFloat(scanResult.summary?.deadRate || '0'),
          wasteSizeBytes: scanResult.summary?.totalDeadBytes || 0,
          totalSizeBytes: scanResult.summary?.totalBytes || 0,
          totalFiles: scanResult.summary?.totalFiles || 0,
          deadFiles: scanResult.deadFiles?.length || 0,
          entryPoints: scanResult.summary?.entryPoints || 0,
          reachableFiles: scanResult.summary?.reachableFiles || 0
        },
        deadCode: {
          files: (scanResult.deadFiles || []).map(f => ({
            path: f.file,
            size: f.size,
            lines: f.lines,
            language: f.language,
            exports: (f.exports || []).map(e => e.name || e)
          }))
        },
        security: { summary: { critical: 0, high: 0, medium: 0, low: 0 } },
        outdated: { packages: [] },
        emissions: { monthly: { kgCO2: 0 } }
      };

      await saveScan(result);

      res.json({ success: true, scan: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Run scan with Server-Sent Events for real-time progress streaming
  router.get('/scan-stream/:projectPath(*)', async (req, res) => {
    const projectPath = decodeURIComponent(req.params.projectPath);

    if (!projectPath) {
      return res.status(400).json({ success: false, error: 'projectPath is required' });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

    // Track recently processed files for display
    const recentFiles = [];
    const MAX_RECENT_FILES = 10;
    let lastPhase = '';
    let lastDetail = '';
    let lastPercent = 0;
    let filesAnalyzed = 0;
    let functionsFound = 0;
    let vulnerabilitiesFound = 0;
    let issuesFound = 0;
    let heartbeatCount = 0;

    // Heartbeat to show activity during long operations
    const heartbeatInterval = setInterval(() => {
      if (lastPhase) {
        heartbeatCount++;
        // Send a heartbeat with animated detail to show activity
        const dots = '.'.repeat((heartbeatCount % 3) + 1);
        const heartbeatDetail = lastDetail || `Processing${dots}`;
        res.write(`data: ${JSON.stringify({
          type: 'progress',
          phase: lastPhase,
          percent: lastPercent,
          detail: heartbeatDetail,
          current: 0,
          total: 0,
          heartbeat: true,
          stats: { filesAnalyzed, functionsFound, issuesFound: issuesFound + vulnerabilitiesFound },
          timestamp: Date.now()
        })}\n\n`);
      }
    }, 1500); // Every 1.5 seconds

    // Progress callback for the scanner
    const onProgress = (progress) => {
      const { phase, percent, detail, current, total } = progress;

      // Debug log every progress event
      console.log(`[SCAN] ${phase} | ${Math.round(percent)}% | ${detail?.slice(-40)} | ${current}/${total}`);

      // Track phase and state for heartbeat
      lastPhase = phase;
      lastDetail = detail || '';
      lastPercent = percent || 0;

      // Determine if this is a file being processed (has file extension or path separator)
      const isActualFile = detail && (
        detail.includes('.mjs') ||
        detail.includes('.js') ||
        detail.includes('.ts') ||
        detail.includes('.tsx') ||
        detail.includes('.jsx') ||
        detail.includes('.css') ||
        detail.includes('.svg') ||
        detail.includes('.png') ||
        detail.includes('.jpg') ||
        detail.includes('/')
      ) && !detail.includes('Found') && !detail.includes('...');

      // Extract current file from detail and track it
      if (isActualFile) {
        const shortName = detail.split('/').pop() || detail;
        if (!recentFiles.includes(shortName)) {
          recentFiles.unshift(shortName);
          if (recentFiles.length > MAX_RECENT_FILES) {
            recentFiles.pop();
          }
        }
      }

      // Accumulate stats based on phase
      if (phase.includes('JavaScript') && current) {
        filesAnalyzed = current;
      }
      if (phase.includes('CSS') && current) {
        filesAnalyzed = current;
      }
      if (phase.includes('duplicate') && detail?.includes('Found')) {
        const match = detail.match(/Found (\d+)/);
        if (match) functionsFound = parseInt(match[1], 10);
      }
      if (phase.includes('security')) {
        vulnerabilitiesFound = current || 0;
      }
      if (phase.includes('dead code') && detail?.includes('Found')) {
        const match = detail.match(/Found (\d+)/);
        if (match) issuesFound = parseInt(match[1], 10);
      }

      // Build the file display lines
      const fileLines = [];

      // Add completed files (show last 2 completed)
      const completedFiles = recentFiles.slice(1, 3);
      for (const file of completedFiles.reverse()) {
        fileLines.push({ file, status: 'complete' });
      }

      // Add current item being processed
      if (isActualFile) {
        // Show actual file name
        const shortCurrent = detail.split('/').pop() || detail;
        fileLines.push({ file: shortCurrent, status: 'processing' });
      } else if (detail) {
        // Show phase status for non-file operations
        fileLines.push({ file: detail, status: 'processing' });
      }

      // Send progress event
      const event = {
        type: 'progress',
        phase,
        percent: Math.round(percent),
        detail: detail || '',
        current: current || 0,
        total: total || 0,
        fileLines,
        stats: {
          filesAnalyzed,
          functionsFound,
          issuesFound: issuesFound + vulnerabilitiesFound,
        },
        timestamp: Date.now(),
      };

      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      // Run the scan with progress callback and performance settings
      const workers = getSetting('performance.workers', 0) || undefined;
      const scanResult = await scanProject(projectPath, { onProgress, workers });

      // Transform Swynx scanner output to storage format
      const result = {
        id: Date.now().toString(),
        projectPath,
        projectName: projectPath.split('/').pop(),
        scannedAt: new Date().toISOString(),
        duration: 0,
        healthScore: { score: Math.round(100 - parseFloat(scanResult.summary?.deadRate || '0')) },
        summary: {
          wastePercent: parseFloat(scanResult.summary?.deadRate || '0'),
          wasteSizeBytes: scanResult.summary?.totalDeadBytes || 0,
          totalSizeBytes: scanResult.summary?.totalBytes || 0,
          totalFiles: scanResult.summary?.totalFiles || 0,
          deadFiles: scanResult.deadFiles?.length || 0,
          entryPoints: scanResult.summary?.entryPoints || 0,
          reachableFiles: scanResult.summary?.reachableFiles || 0
        },
        deadCode: {
          files: (scanResult.deadFiles || []).map(f => ({
            path: f.file,
            size: f.size,
            lines: f.lines,
            language: f.language,
            exports: (f.exports || []).map(e => e.name || e)
          }))
        },
        security: { summary: { critical: 0, high: 0, medium: 0, low: 0 } },
        outdated: { packages: [] },
        emissions: { monthly: { kgCO2: 0 } }
      };

      await saveScan(result);

      // Pre-warm AI model in background after scan (so it's ready for qualification)
      import('../../ai/ollama.mjs')
        .then(({ warmModel }) => warmModel())
        .catch(() => {});

      // Send completion event with full result
      res.write(`data: ${JSON.stringify({
        type: 'complete',
        scan: result,
        timestamp: Date.now()
      })}\n\n`);

    } catch (error) {
      console.error('Scan error:', error);
      // Send error event
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error.message || 'Unknown scan error',
        timestamp: Date.now()
      })}\n\n`);
    } finally {
      clearInterval(heartbeatInterval);
      res.end();
    }
  });

  // === Stats ===

  // Get project stats for trend chart
  router.get('/stats/:projectPath(*)', async (req, res) => {
    try {
      const projectPath = decodeURIComponent(req.params.projectPath);
      const days = parseInt(req.query.days, 10) || 30;
      const stats = await getProjectStats(projectPath, days);
      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === Fix Modules ===

  // List available fix modules
  router.get('/fix/modules', (req, res) => {
    try {
      const modules = listModules();
      res.json({ success: true, modules });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get fix status for a project (requires latest scan)
  router.get('/fix/status/:projectPath(*)', async (req, res) => {
    try {
      const projectPath = decodeURIComponent(req.params.projectPath);

      // Get latest scan
      const scans = await getRecentScans(projectPath, 1);
      if (scans.length === 0) {
        return res.json({
          success: true,
          status: null,
          message: 'No scan data available. Run a scan first.'
        });
      }

      // Parse raw_data if it's a string
      let scanResult;
      if (typeof scans[0].raw_data === 'string') {
        scanResult = JSON.parse(scans[0].raw_data);
      } else {
        scanResult = scans[0].raw_data || scans[0];
      }

      const status = getFixStatus(projectPath, scanResult);
      res.json({ success: true, status });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Preview a fix
  router.get('/fix/preview/:moduleId/:projectPath(*)', async (req, res) => {
    try {
      const { moduleId } = req.params;
      const projectPath = decodeURIComponent(req.params.projectPath);

      // Get latest scan
      const scans = await getRecentScans(projectPath, 1);
      if (scans.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No scan data available. Run a scan first.'
        });
      }

      let scanResult;
      if (typeof scans[0].raw_data === 'string') {
        scanResult = JSON.parse(scans[0].raw_data);
      } else {
        scanResult = scans[0].raw_data || scans[0];
      }

      const preview = previewModule(moduleId, scanResult);
      res.json({ success: true, preview });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Apply a fix
  router.post('/fix/apply', async (req, res) => {
    try {
      const { projectPath, moduleId, options } = req.body;

      if (!projectPath || !moduleId) {
        return res.status(400).json({
          success: false,
          error: 'projectPath and moduleId are required'
        });
      }

      // Get latest scan
      const scans = await getRecentScans(projectPath, 1);
      if (scans.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No scan data available. Run a scan first.'
        });
      }

      let scanResult;
      if (typeof scans[0].raw_data === 'string') {
        scanResult = JSON.parse(scans[0].raw_data);
      } else {
        scanResult = scans[0].raw_data || scans[0];
      }

      // Apply fix with allowLowConfidence for dashboard usage
      const result = await applyFix(projectPath, moduleId, scanResult, {
        ...options,
        allowLowConfidence: true
      });

      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === Quarantine ===

  // List quarantine sessions for a project
  router.get('/quarantine/:projectPath(*)', (req, res) => {
    try {
      const projectPath = decodeURIComponent(req.params.projectPath);
      const sessions = listSessions(projectPath);

      // Calculate summary
      const summary = {
        totalSessions: sessions.length,
        totalFiles: sessions.reduce((sum, s) => sum + (s.fileCount || 0), 0),
        totalSize: sessions.reduce((sum, s) => sum + (s.totalSize || 0), 0)
      };

      res.json({ success: true, sessions, summary });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Restore a quarantine session
  router.post('/quarantine/restore', (req, res) => {
    try {
      const { projectPath, sessionId } = req.body;

      if (!projectPath || !sessionId) {
        return res.status(400).json({
          success: false,
          error: 'projectPath and sessionId are required'
        });
      }

      const result = restoreSession(projectPath, sessionId);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Purge a quarantine session
  router.post('/quarantine/purge', (req, res) => {
    try {
      const { projectPath, sessionId } = req.body;

      if (!projectPath || !sessionId) {
        return res.status(400).json({
          success: false,
          error: 'projectPath and sessionId are required'
        });
      }

      const result = purgeSession(projectPath, sessionId);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === Drill-Down Endpoints ===

  // Get score breakdown
  router.get('/drill/score/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const healthScore = scanData.healthScore || {};
      const summary = scanData.summary || {};
      const security = scanData.security || {};

      // Calculate component scores
      const wasteScore = Math.max(0, 30 - (summary.wastePercent || 0) * 0.5);
      const securityIssues = (security.critical?.length || 0) + (security.high?.length || 0);
      const securityScore = Math.max(0, 40 - securityIssues * 5);

      res.json({
        success: true,
        score: healthScore.score || 0,
        grade: healthScore.grade || 'F',
        description: healthScore.summary || '',
        components: {
          waste: {
            score: Math.round(wasteScore),
            maxScore: 30,
            percent: summary.wastePercent || 0,
            details: {
              unusedDeps: formatBytes(scanData.details?.unusedDeps?.reduce((s, d) => s + (d.sizeBytes || 0), 0) || 0),
              deadCode: formatBytes(scanData.details?.deadCode?.totalSizeBytes || 0)
            }
          },
          security: {
            score: Math.round(securityScore),
            maxScore: 40,
            critical: security.critical?.length || 0,
            high: security.high?.length || 0,
            medium: security.medium?.length || 0,
            low: security.low?.length || 0
          },
          outdated: {
            score: Math.max(0, 20 - (scanData.outdated?.totalOutdated || 0)),
            maxScore: 20,
            total: scanData.outdated?.totalOutdated || 0,
            major: scanData.outdated?.major?.length || 0
          },
          emissions: {
            score: 10,
            maxScore: 10,
            monthlyCO2: scanData.emissions?.current?.monthlyCO2Kg || 0
          }
        },
        deductions: healthScore.deductions || []
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get waste/cost breakdown
  router.get('/drill/costs/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const summary = scanData.summary || {};
      const details = scanData.details || {};
      const emissions = scanData.emissions || {};
      const costs = scanData.costs || {};

      const unusedDepBytes = details.unusedDeps?.reduce((s, d) => s + (d.sizeBytes || 0), 0) || 0;
      const deadCodeBytes = details.deadCode?.totalSizeBytes || 0;

      // Use new full-depth assets data if available
      const assetsData = details.assets || {};
      const unusedAssetBytes = assetsData.summary?.unusedSize || details.unusedAssets?.reduce((s, a) => s + (a.sizeBytes || 0), 0) || 0;
      const assetOptimisationBytes = assetsData.summary?.potentialSavings || details.assetOptimisation?.potentialSavings || 0;

      res.json({
        success: true,
        waste: {
          totalBytes: summary.wasteSizeBytes || 0,
          totalFormatted: formatBytes(summary.wasteSizeBytes || 0),
          percent: summary.wastePercent || 0,
          breakdown: {
            unusedDeps: { bytes: unusedDepBytes, formatted: formatBytes(unusedDepBytes) },
            deadCode: { bytes: deadCodeBytes, formatted: formatBytes(deadCodeBytes) },
            unusedAssets: { bytes: unusedAssetBytes, formatted: formatBytes(unusedAssetBytes) },
            unoptimisedAssets: { bytes: assetOptimisationBytes, formatted: formatBytes(assetOptimisationBytes) }
          }
        },
        assets: {
          total: assetsData.summary?.totalAssets || 0,
          unused: assetsData.summary?.unusedAssets || 0,
          optimisable: assetsData.summary?.optimisableAssets || 0,
          potentialSavings: formatBytes(assetsData.summary?.potentialSavings || 0)
        },
        co2: {
          monthlyKg: emissions.current?.monthlyCO2Kg || 0,
          annualKg: emissions.current?.annualCO2Kg || 0
        },
        // Full cost data from scan (includes formulas if available)
        costs: costs.enabled ? {
          enabled: true,
          methodology: costs.methodology,
          version: costs.version,
          currency: costs.currency,
          currencySymbol: costs.currencySymbol,
          mode: costs.mode,
          config: costs.config,
          current: costs.current,
          waste: costs.waste,
          potentialSavings: costs.potentialSavings,
          formulas: costs.formulas,
          perFinding: costs.perFinding
        } : {
          // Fallback for old scan data without new cost calculator
          enabled: false,
          monthly: {
            bandwidth: ((summary.wasteSizeBytes || 0) / 1024 / 1024 / 1024) * 10000 * 0.085,
            total: ((summary.wasteSizeBytes || 0) / 1024 / 1024 / 1024) * 10000 * 0.085
          }
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get unused dependencies detail
  router.get('/drill/unused-deps/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const unusedDeps = scanData.details?.unusedDeps || [];

      res.json({
        success: true,
        total: unusedDeps.length,
        totalSize: unusedDeps.reduce((s, d) => s + (d.sizeBytes || 0), 0),
        totalSizeFormatted: formatBytes(unusedDeps.reduce((s, d) => s + (d.sizeBytes || 0), 0)),
        dependencies: unusedDeps.map(dep => ({
          name: dep.name || dep,
          version: dep.version,
          sizeBytes: dep.sizeBytes || 0,
          sizeFormatted: formatBytes(dep.sizeBytes || 0),
          command: `npm uninstall ${dep.name || dep}`
        }))
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get specific unused dependency detail - returns full enrichment data
  router.get('/drill/unused-deps/:scanId/:packageName', async (req, res) => {
    try {
      const { scanId, packageName } = req.params;
      const scan = await getScanById(scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const unusedDeps = scanData.details?.unusedDeps || [];
      const dep = unusedDeps.find(d => (d.name || d) === packageName);

      if (!dep) {
        return res.status(404).json({ success: false, error: 'Package not found' });
      }

      // Return the full enrichment data from the scan
      res.json({
        success: true,
        package: {
          name: dep.name,
          version: dep.version,
          declaredIn: dep.declaredIn || 'dependencies',
          sizeBytes: dep.sizeBytes || 0,
          sizeFormatted: dep.sizeFormatted || formatBytes(dep.sizeBytes || 0),
          // Evidence of thoroughness
          evidence: dep.evidence || null,
          // Git history
          gitHistory: dep.gitHistory || null,
          // Size analysis
          size: dep.size || null,
          // Cost impact
          cost: dep.cost || null,
          // Lighter alternatives
          alternatives: dep.alternatives || [],
          // What depends on this
          dependents: dep.dependents || null,
          // Final recommendation with rich reasoning
          recommendation: dep.recommendation || {
            action: 'investigate',
            confidence: 'low',
            command: `npm uninstall ${dep.name}`,
            reasoning: 'No enrichment data available - re-run scan.'
          }
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get dead code summary
  router.get('/drill/dead-code/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const deadCode = scanData.details?.deadCode || {};

      // Support both old (orphanFiles) and new (fullyDeadFiles/partiallyDeadFiles) format
      const fullyDeadFiles = deadCode.fullyDeadFiles || deadCode.orphanFiles || [];
      const partiallyDeadFiles = deadCode.partiallyDeadFiles || [];
      const entryPoints = deadCode.entryPoints || [];
      const summary = deadCode.summary || {};

      // Calculate totals
      const fullyDeadBytes = fullyDeadFiles.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
      const partiallyDeadBytes = partiallyDeadFiles.reduce((sum, f) => sum + (f.summary?.deadBytes || 0), 0);
      const totalDeadBytes = summary.totalDeadBytes || (fullyDeadBytes + partiallyDeadBytes);
      const totalDeadExports = summary.totalDeadExports ||
        (fullyDeadFiles.reduce((sum, f) => sum + (f.summary?.deadExports || f.exports?.length || 0), 0) +
         partiallyDeadFiles.reduce((sum, f) => sum + (f.summary?.deadExports || 0), 0));

      // Build quick wins
      const quickWins = [];
      if (fullyDeadFiles.length > 0) {
        quickWins.push({
          type: 'delete-dead-files',
          title: `Delete ${fullyDeadFiles.length} fully dead file(s)`,
          savings: formatBytes(fullyDeadBytes),
          effort: 'low',
          confidence: 'high',
          files: fullyDeadFiles.slice(0, 5).map(f => f.file || f.relativePath)
        });
      }
      if (partiallyDeadFiles.length > 0) {
        const totalPartialDeadExports = partiallyDeadFiles.reduce((sum, f) => sum + (f.summary?.deadExports || 0), 0);
        quickWins.push({
          type: 'remove-dead-exports',
          title: `Remove ${totalPartialDeadExports} dead export(s) from ${partiallyDeadFiles.length} file(s)`,
          savings: formatBytes(partiallyDeadBytes),
          effort: 'medium',
          confidence: 'medium'
        });
      }

      res.json({
        success: true,
        overview: {
          totalDeadBytes: formatBytes(totalDeadBytes),
          totalDeadExports,
          filesAnalysed: summary.filesAnalysed || scanData.summary?.jsFileCount || 0,
          breakdown: [
            {
              category: 'Fully Dead Files',
              count: fullyDeadFiles.length,
              size: formatBytes(fullyDeadBytes)
            },
            {
              category: 'Partially Dead Files',
              count: partiallyDeadFiles.length,
              size: formatBytes(partiallyDeadBytes)
            },
            {
              category: 'Entry Points (Excluded)',
              count: entryPoints.length,
              size: 'N/A'
            }
          ]
        },
        fullyDeadFiles: fullyDeadFiles.map(f => ({
          file: f.file || f.relativePath,
          relativePath: f.relativePath || f.file,
          sizeBytes: f.sizeBytes || 0,
          sizeFormatted: f.sizeFormatted || formatBytes(f.sizeBytes || 0),
          lineCount: f.lineCount,
          status: f.status || 'fully-dead',
          exports: f.exports || [],
          summary: f.summary,
          recommendation: f.recommendation,
          gitHistory: f.gitHistory,
          costImpact: f.costImpact
        })),
        partiallyDeadFiles: partiallyDeadFiles.map(f => ({
          file: f.file || f.relativePath,
          relativePath: f.relativePath || f.file,
          sizeBytes: f.sizeBytes || 0,
          sizeFormatted: f.sizeFormatted || formatBytes(f.sizeBytes || 0),
          lineCount: f.lineCount,
          status: f.status || 'partially-dead',
          exports: f.exports || [],
          summary: f.summary,
          recommendation: f.recommendation
        })),
        entryPoints: entryPoints.slice(0, 30),
        quickWins
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get dead code file detail
  router.get('/drill/dead-code/:scanId/:filePath(*)', async (req, res) => {
    try {
      const { scanId, filePath } = req.params;
      const scan = await getScanById(scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const deadCode = scanData.details?.deadCode || {};

      // Support both old and new format
      const fullyDeadFiles = deadCode.fullyDeadFiles || deadCode.orphanFiles || [];
      const partiallyDeadFiles = deadCode.partiallyDeadFiles || [];
      const allDeadFiles = [...fullyDeadFiles, ...partiallyDeadFiles];

      const file = allDeadFiles.find(f =>
        (f.relativePath || f.file) === filePath ||
        (f.file || '').endsWith(filePath) ||
        filePath.endsWith(f.file || f.relativePath || '')
      );

      if (!file) {
        // Check if it's an entry point
        const entryPoint = (deadCode.entryPoints || []).find(e =>
          e.file === filePath || filePath.endsWith(e.file)
        );

        if (entryPoint) {
          return res.json({
            success: true,
            status: 'entry-point',
            message: `File is an entry point: ${entryPoint.reason}`,
            file: entryPoint
          });
        }

        return res.json({
          success: true,
          status: 'clean',
          message: 'File not found in dead code analysis - likely all exports are in use'
        });
      }

      res.json({
        success: true,
        file: {
          file: file.file || file.relativePath,
          relativePath: file.relativePath || file.file,
          sizeBytes: file.sizeBytes || 0,
          sizeFormatted: file.sizeFormatted || formatBytes(file.sizeBytes || 0),
          lineCount: file.lineCount,
          status: file.status,
          exports: file.exports || [],
          summary: file.summary,
          gitHistory: file.gitHistory,
          costImpact: file.costImpact,
          recommendation: file.recommendation
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get security vulnerabilities detail
  router.get('/drill/security/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const security = scanData.security || {};

      // Support both old and new format
      const summary = security.summary || {
        total: (security.critical?.length || 0) + (security.high?.length || 0) +
               (security.medium?.length || 0) + (security.low?.length || 0),
        critical: security.critical?.length || 0,
        high: security.high?.length || 0,
        medium: security.medium?.length || 0,
        low: security.low?.length || 0,
        actuallyExploitable: 0,
        auditFlagsOnly: 0
      };

      // Get vulnerabilities (prefer new format)
      const vulnerabilities = security.vulnerabilities || [
        ...(security.critical || []).map(v => ({ ...v, severity: 'critical' })),
        ...(security.high || []).map(v => ({ ...v, severity: 'high' })),
        ...(security.medium || []).map(v => ({ ...v, severity: 'medium' })),
        ...(security.low || []).map(v => ({ ...v, severity: 'low' }))
      ];

      // Build quick wins
      const quickWins = [];
      const exploitable = vulnerabilities.filter(v => v.evidence?.actualRisk === 'high');
      const auditFlags = vulnerabilities.filter(v =>
        v.evidence?.actualRisk === 'low' || v.evidence?.actualRisk === 'none'
      );

      if (exploitable.length > 0) {
        quickWins.push({
          type: 'critical-fixes',
          title: `Fix ${exploitable.length} exploitable vulnerability(s)`,
          effort: 'high',
          priority: 'immediate',
          packages: [...new Set(exploitable.map(v => v.package))].slice(0, 5)
        });
      }

      if (auditFlags.length > 0) {
        quickWins.push({
          type: 'audit-flags',
          title: `Clear ${auditFlags.length} audit flag(s)`,
          effort: 'low',
          priority: 'when-convenient',
          command: 'npm audit fix'
        });
      }

      res.json({
        success: true,
        summary: {
          total: summary.total,
          critical: summary.critical,
          high: summary.high,
          medium: summary.medium,
          low: summary.low,
          actuallyExploitable: summary.actuallyExploitable || exploitable.length,
          auditFlagsOnly: summary.auditFlagsOnly || auditFlags.length,
          headline: summary.headline || buildSecurityHeadline(summary, exploitable.length)
        },
        overview: {
          total: summary.total,
          breakdown: [
            { severity: 'Critical', count: summary.critical, color: '#ff4444', actualRisk: countByActualRisk(vulnerabilities, 'critical') },
            { severity: 'High', count: summary.high, color: '#ff8800', actualRisk: countByActualRisk(vulnerabilities, 'high') },
            { severity: 'Medium', count: summary.medium, color: '#ffcc00', actualRisk: countByActualRisk(vulnerabilities, 'medium') },
            { severity: 'Low', count: summary.low, color: '#888888', actualRisk: countByActualRisk(vulnerabilities, 'low') }
          ]
        },
        vulnerabilities: vulnerabilities.map(v => ({
          id: v.id || v.cveId,
          package: v.package,
          installedVersion: v.installedVersion,
          severity: v.severity,
          severityScore: v.severityScore,
          title: v.title,
          description: v.description,
          cweId: v.cweId,
          cweTitle: v.cweTitle,
          affected: v.affected,
          evidence: v.evidence,
          fix: v.fix,
          compliance: v.compliance,
          recommendation: v.recommendation,
          references: v.references
        })),
        byPackage: security.byPackage || {},
        quickWins
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get specific package vulnerability detail
  router.get('/drill/security/:scanId/:packageName', async (req, res) => {
    try {
      const { scanId, packageName } = req.params;
      const scan = await getScanById(scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const security = scanData.security || {};

      // Check byPackage first (new format)
      if (security.byPackage?.[packageName]) {
        const pkgData = security.byPackage[packageName];
        return res.json({
          success: true,
          package: packageName,
          installedVersion: pkgData.installedVersion,
          latestVersion: pkgData.latestVersion,
          isDirect: pkgData.isDirect,
          summary: pkgData.summary,
          vulnerabilities: pkgData.vulnerabilities
        });
      }

      // Fall back to searching vulnerabilities array
      const vulnerabilities = security.vulnerabilities || [
        ...(security.critical || []).map(v => ({ ...v, severity: 'critical' })),
        ...(security.high || []).map(v => ({ ...v, severity: 'high' })),
        ...(security.medium || []).map(v => ({ ...v, severity: 'medium' })),
        ...(security.low || []).map(v => ({ ...v, severity: 'low' }))
      ];

      const pkgVulns = vulnerabilities.filter(v => v.package === packageName);

      if (pkgVulns.length === 0) {
        return res.status(404).json({ success: false, error: 'No vulnerabilities found for this package' });
      }

      res.json({
        success: true,
        package: packageName,
        installedVersion: pkgVulns[0]?.installedVersion,
        vulnerabilities: pkgVulns
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Helper function for security headline
  function buildSecurityHeadline(summary, exploitableCount) {
    if (summary.total === 0) {
      return 'No known vulnerabilities detected.';
    }
    if (exploitableCount === 0) {
      return `${summary.total} vulnerability(s) found, but none are exploitable in your codebase.`;
    }
    return `${exploitableCount} exploitable vulnerability(s) found requiring immediate action.`;
  }

  // Helper to count actual risk by severity
  function countByActualRisk(vulns, severity) {
    const sevVulns = vulns.filter(v => v.severity === severity);
    return {
      high: sevVulns.filter(v => v.evidence?.actualRisk === 'high').length,
      medium: sevVulns.filter(v => v.evidence?.actualRisk === 'medium').length,
      low: sevVulns.filter(v => v.evidence?.actualRisk === 'low' || v.evidence?.actualRisk === 'none').length
    };
  }

  // Get import graph for a file
  router.get('/drill/imports/:scanId/:filePath(*)', async (req, res) => {
    try {
      const { scanId, filePath } = req.params;
      const scan = await getScanById(scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const importGraph = scanData.details?.importGraph || {};
      const files = importGraph.files || {};

      // Find the file in the import graph
      const fileData = files[filePath] || Object.values(files).find(f =>
        (f.relativePath || f.file) === filePath ||
        (f.file || '').endsWith(filePath)
      );

      if (!fileData) {
        return res.json({
          success: true,
          file: { relativePath: filePath },
          imports: [],
          importedBy: [],
          message: 'File not found in import graph'
        });
      }

      res.json({
        success: true,
        file: {
          relativePath: fileData.relativePath || filePath,
          sizeBytes: fileData.sizeBytes || 0,
          lineCount: fileData.lineCount || 0,
          imports: fileData.imports || [],
          exports: fileData.exports || []
        },
        importedBy: fileData.importedBy || [],
        importerCount: (fileData.importedBy || []).length,
        isOrphaned: (fileData.importedBy || []).length === 0
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === Asset Drill-Down Endpoints ===

  // Get full assets analysis summary
  router.get('/drill/assets/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const assets = scanData.details?.assets || {};

      // Build headline
      const headline = buildAssetsHeadline(assets.summary || {});

      res.json({
        success: true,
        headline,
        summary: assets.summary || {
          totalAssets: 0,
          totalSize: 0,
          unusedAssets: 0,
          unusedSize: 0,
          optimisableAssets: 0,
          potentialSavings: 0
        },
        unusedAssets: (assets.unusedAssets || []).slice(0, 50).map(a => ({
          file: a.file,
          relativePath: a.relativePath,
          sizeBytes: a.sizeBytes,
          sizeFormatted: a.sizeFormatted,
          type: a.type,
          format: a.format,
          dimensions: a.dimensions,
          gitHistory: a.gitHistory,
          recommendation: a.recommendation
        })),
        optimisableAssets: (assets.optimisableAssets || []).slice(0, 50).map(a => ({
          file: a.file,
          relativePath: a.relativePath,
          sizeBytes: a.sizeBytes,
          sizeFormatted: a.sizeFormatted,
          type: a.type,
          format: a.format,
          dimensions: a.dimensions,
          optimisation: a.optimisation,
          costImpact: a.costImpact,
          recommendation: a.recommendation
        })),
        byType: {
          image: {
            count: assets.byType?.image?.length || 0,
            size: formatBytes((assets.byType?.image || []).reduce((s, a) => s + (a.sizeBytes || 0), 0))
          },
          font: {
            count: assets.byType?.font?.length || 0,
            size: formatBytes((assets.byType?.font || []).reduce((s, a) => s + (a.sizeBytes || 0), 0))
          },
          video: {
            count: assets.byType?.video?.length || 0,
            size: formatBytes((assets.byType?.video || []).reduce((s, a) => s + (a.sizeBytes || 0), 0))
          },
          audio: {
            count: assets.byType?.audio?.length || 0,
            size: formatBytes((assets.byType?.audio || []).reduce((s, a) => s + (a.sizeBytes || 0), 0))
          },
          document: {
            count: assets.byType?.document?.length || 0,
            size: formatBytes((assets.byType?.document || []).reduce((s, a) => s + (a.sizeBytes || 0), 0))
          }
        },
        quickWins: assets.quickWins || []
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Helper function for assets headline
  function buildAssetsHeadline(summary) {
    const parts = [];

    if (summary.totalAssets > 0) {
      parts.push(`${summary.totalAssets} assets found`);
    }

    if (summary.unusedAssets > 0) {
      parts.push(`${summary.unusedAssets} unused (${formatBytes(summary.unusedSize)})`);
    }

    if (summary.optimisableAssets > 0) {
      parts.push(`${summary.optimisableAssets} can be optimised (${formatBytes(summary.potentialSavings)} potential savings)`);
    }

    if (parts.length === 0) {
      return 'No assets found.';
    }

    return parts.join('. ') + '.';
  }

  // Get specific asset detail
  router.get('/drill/assets/:scanId/:filePath(*)', async (req, res) => {
    try {
      const { scanId, filePath } = req.params;
      const scan = await getScanById(scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const assets = scanData.details?.assets || {};

      // Find the asset
      const asset = (assets.assets || []).find(a =>
        a.relativePath === filePath ||
        a.file === filePath ||
        (a.file || '').endsWith(filePath) ||
        filePath.endsWith(a.file || '')
      );

      if (!asset) {
        return res.status(404).json({
          success: false,
          error: 'Asset not found',
          message: `No asset found matching: ${filePath}`
        });
      }

      res.json({
        success: true,
        asset: {
          file: asset.file,
          relativePath: asset.relativePath,
          sizeBytes: asset.sizeBytes,
          sizeFormatted: asset.sizeFormatted,
          type: asset.type,
          format: asset.format,
          dimensions: asset.dimensions,
          analysis: asset.analysis,
          usage: asset.usage,
          optimisation: asset.optimisation,
          gitHistory: asset.gitHistory,
          costImpact: asset.costImpact,
          recommendation: asset.recommendation
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get outdated dependencies detail - full depth
  router.get('/drill/outdated/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const outdated = scanData.outdated || {};

      // Support both new and old format
      const summary = outdated.summary || {
        total: outdated.totalOutdated || (outdated.packages?.length || 0),
        major: outdated.major?.length || 0,
        minor: outdated.minor?.length || 0,
        patch: outdated.patch?.length || 0,
        deprecated: outdated.deprecated?.length || 0,
        unmaintained: 0,
        withSecurityFixes: outdated.critical?.length || 0
      };

      res.json({
        success: true,
        headline: outdated.headline || buildOutdatedHeadline(summary),
        summary,
        // Full package list with all enrichment data (filter invalid entries)
        packages: (outdated.packages || [])
          .filter(p => p && (p.package || p.name) && (p.current || p.installedVersion) && (p.latest || p.latestVersion))
          .slice(0, 50)
          .map(p => ({
          package: p.package || p.name,
          current: p.current || p.installedVersion,
          wanted: p.wanted,
          latest: p.latest || p.latestVersion,
          latestMajor: p.latestMajor,
          updateType: p.updateType,
          versionsBehind: p.versionsBehind,
          daysBehind: p.daysBehind,
          currentReleased: p.currentReleased,
          latestReleased: p.latestReleased,
          packageHealth: p.packageHealth,
          securityFixes: p.securityFixes,
          changelog: p.changelog,
          majorVersionAvailable: p.majorVersionAvailable,
          dependents: p.dependents,
          costOfNotUpdating: p.costOfNotUpdating,
          effort: p.effort,
          recommendation: p.recommendation
        })),
        // Categorised lists (filter invalid entries)
        critical: (outdated.critical || [])
          .filter(p => p && p.package && p.current && p.latest)
          .slice(0, 20)
          .map(p => ({
            package: p.package,
            current: p.current,
            latest: p.latest,
            securityFixes: p.securityFixes,
            recommendation: p.recommendation
          })),
        deprecated: (outdated.deprecated || [])
          .filter(p => p && p.package && p.current)
          .slice(0, 20)
          .map(p => ({
            package: p.package,
            current: p.current,
            latest: p.latest,
            packageHealth: p.packageHealth,
            recommendation: p.recommendation
          })),
        major: (outdated.major || [])
          .filter(p => p && (p.package || p.name) && (p.current || p.installedVersion))
          .slice(0, 20)
          .map(p => ({
            package: p.package || p.name,
            current: p.current || p.installedVersion,
            latest: p.latest || p.latestVersion,
            majorVersionAvailable: p.majorVersionAvailable,
            changelog: p.changelog,
            effort: p.effort,
            recommendation: p.recommendation
          })),
        minor: (outdated.minor || [])
          .filter(p => p && (p.package || p.name) && (p.current || p.installedVersion))
          .slice(0, 20)
          .map(p => ({
            package: p.package || p.name,
            current: p.current || p.installedVersion,
            latest: p.latest || p.latestVersion,
            effort: p.effort,
            recommendation: p.recommendation
          })),
        patch: (outdated.patch || [])
          .filter(p => p && (p.package || p.name) && (p.current || p.installedVersion))
          .slice(0, 20)
          .map(p => ({
            package: p.package || p.name,
            current: p.current || p.installedVersion,
            latest: p.latest || p.latestVersion,
            recommendation: p.recommendation
          })),
        quickWins: outdated.quickWins || []
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Helper for building outdated headline (for backwards compatibility)
  function buildOutdatedHeadline(summary) {
    const parts = [];
    parts.push(`${summary.total} outdated package${summary.total !== 1 ? 's' : ''}`);
    if (summary.withSecurityFixes > 0) {
      parts.push(`${summary.withSecurityFixes} with security fixes (update now)`);
    }
    if (summary.deprecated > 0) {
      parts.push(`${summary.deprecated} deprecated (needs replacement)`);
    }
    const safeUpdates = summary.total - (summary.withSecurityFixes || 0) - (summary.deprecated || 0);
    if (safeUpdates > 0) {
      parts.push(`${safeUpdates} can be updated when convenient`);
    }
    return parts.join('. ') + '.';
  }

  // Get specific outdated package detail
  router.get('/drill/outdated/:scanId/:packageName', async (req, res) => {
    try {
      const { scanId, packageName } = req.params;
      const scan = await getScanById(scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const outdated = scanData.outdated || {};

      // Find the package
      const pkg = (outdated.packages || []).find(p =>
        (p.package || p.name) === packageName
      );

      if (!pkg) {
        return res.status(404).json({
          success: false,
          error: 'Package not found in outdated list'
        });
      }

      res.json({
        success: true,
        package: {
          package: pkg.package,
          current: pkg.current,
          wanted: pkg.wanted,
          latest: pkg.latest,
          latestMajor: pkg.latestMajor,
          updateType: pkg.updateType,
          versionsBehind: pkg.versionsBehind,
          daysBehind: pkg.daysBehind,
          currentReleased: pkg.currentReleased,
          latestReleased: pkg.latestReleased,
          packageHealth: pkg.packageHealth,
          securityFixes: pkg.securityFixes,
          changelog: pkg.changelog,
          majorVersionAvailable: pkg.majorVersionAvailable,
          dependents: pkg.dependents,
          costOfNotUpdating: pkg.costOfNotUpdating,
          effort: pkg.effort,
          recommendation: pkg.recommendation
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Helper function for formatting bytes
  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  // === Bundles Analysis ===

  // Get bundle analysis
  router.get('/drill/bundles/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const bundles = scanData.bundles || scanData.details?.bundles || {};
      const summary = scanData.summary || {};

      // Build bundle data from available information
      const buildInfo = scanData.emissions?.buildInfo || {};
      const totalSize = buildInfo.buildOutputSize || summary.totalSizeBytes || 0;

      res.json({
        success: true,
        headline: bundles.headline || `Build output: ${formatBytes(totalSize)}`,
        summary: {
          totalSize: formatBytes(totalSize),
          totalSizeBytes: totalSize,
          entryPoints: bundles.entryPoints?.length || 0,
          chunks: bundles.chunks?.length || 0,
          hasBuildFolder: buildInfo.hasBuildFolder || false,
          buildOutputSize: formatBytes(buildInfo.buildOutputSize || 0),
          sourceSize: formatBytes(buildInfo.sourceSize || 0)
        },
        entryPoints: (bundles.entryPoints || []).map(e => ({
          name: e.name,
          file: e.file,
          sizeBytes: e.sizeBytes || 0,
          sizeFormatted: formatBytes(e.sizeBytes || 0),
          chunks: e.chunks || [],
          dependencies: e.dependencies || []
        })),
        chunks: (bundles.chunks || []).slice(0, 50).map(c => ({
          name: c.name,
          file: c.file,
          sizeBytes: c.sizeBytes || 0,
          sizeFormatted: formatBytes(c.sizeBytes || 0),
          type: c.type || 'chunk',
          modules: c.modules || []
        })),
        largestModules: (bundles.largestModules || []).slice(0, 20).map(m => ({
          name: m.name,
          file: m.file,
          sizeBytes: m.sizeBytes || 0,
          sizeFormatted: formatBytes(m.sizeBytes || 0),
          percentage: m.percentage || 0
        })),
        treeshaking: bundles.treeshaking || null
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === CSS Analysis ===

  // Get CSS analysis
  router.get('/drill/css/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const summary = scanData.summary || {};

      // cssAnalysis from scanner is an array of parsed CSS files
      let cssAnalysisRaw = scanData.details?.cssAnalysis || scanData.cssAnalysis || [];

      // If it's an object (new format), use it directly
      if (!Array.isArray(cssAnalysisRaw)) {
        cssAnalysisRaw = cssAnalysisRaw.files || [];
      }

      // Build files array from raw CSS analysis
      const files = cssAnalysisRaw.map(css => ({
        file: css.file?.path || css.file,
        relativePath: css.file?.relativePath || css.relativePath || css.file,
        sizeBytes: css.size || 0,
        sizeFormatted: formatBytes(css.size || 0),
        selectors: css.selectors?.length || css.rules || 0,
        unusedSelectors: 0, // Would need HTML analysis to determine
        duplicates: 0,
        lineCount: css.lines || 0
      }));

      const totalCssFiles = files.length || summary.cssFileCount || 0;
      const totalCssSize = files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);

      res.json({
        success: true,
        headline: `${totalCssFiles} CSS file${totalCssFiles === 1 ? '' : 's'} analysed`,
        summary: {
          totalFiles: totalCssFiles,
          totalSize: formatBytes(totalCssSize),
          totalSizeBytes: totalCssSize,
          unusedSelectorsCount: 0,
          duplicateRulesCount: 0,
          potentialSavings: formatBytes(0),
          potentialSavingsBytes: 0
        },
        files: files.slice(0, 50),
        unusedSelectors: [],
        duplicateRules: [],
        mediaQueries: [],
        frameworks: detectCssFrameworks(cssAnalysisRaw)
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Helper to detect CSS frameworks from content
  function detectCssFrameworks(cssFiles) {
    const frameworks = new Set();
    for (const css of cssFiles) {
      const content = css.content || '';
      if (content.includes('tailwind') || content.includes('@apply')) frameworks.add('Tailwind CSS');
      if (content.includes('bootstrap') || content.includes('.container-fluid')) frameworks.add('Bootstrap');
      if (content.includes('foundation')) frameworks.add('Foundation');
      if (content.includes('bulma')) frameworks.add('Bulma');
      if (content.includes('materialize')) frameworks.add('Materialize');
    }
    return Array.from(frameworks);
  }

  // === Duplicates Analysis ===

  // Get duplicate code analysis
  router.get('/drill/duplicates/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const duplicates = scanData.duplicates || scanData.details?.duplicates || {};
      const summary = scanData.summary || {};

      const similarBlocks = duplicates.similarBlocks || [];
      const duplicateFunctions = duplicates.duplicateFunctions || [];
      const totalDuplicateBytes = summary.duplicateBytes || duplicates.totalBytes || 0;

      res.json({
        success: true,
        headline: duplicates.headline || `${similarBlocks.length + duplicateFunctions.length} duplicate code patterns found`,
        summary: {
          totalDuplicates: similarBlocks.length + duplicateFunctions.length,
          similarBlocks: similarBlocks.length,
          duplicateFunctions: duplicateFunctions.length,
          totalBytes: totalDuplicateBytes,
          totalFormatted: formatBytes(totalDuplicateBytes),
          potentialSavings: formatBytes(duplicates.potentialSavings || Math.floor(totalDuplicateBytes * 0.5))
        },
        similarBlocks: similarBlocks.slice(0, 30).map(b => ({
          id: b.id,
          hash: b.hash,
          lineCount: b.lineCount || 0,
          sizeBytes: b.sizeBytes || 0,
          sizeFormatted: formatBytes(b.sizeBytes || 0),
          occurrences: (b.occurrences || b.locations || []).map(o => ({
            file: o.file,
            relativePath: o.relativePath,
            startLine: o.startLine,
            endLine: o.endLine
          })),
          preview: b.preview || b.code?.substring(0, 200),
          recommendation: b.recommendation || {
            action: 'Extract to shared utility',
            confidence: 'medium'
          }
        })),
        duplicateFunctions: duplicateFunctions.slice(0, 30).map(f => {
          const occurrences = f.occurrences || f.locations || [];
          // Use actual size if available, otherwise estimate ~500 bytes per occurrence
          const actualSize = f.sizeBytes || occurrences.reduce((sum, o) => sum + (o.sizeBytes || 500), 0);
          const totalLines = f.totalLines || occurrences.reduce((sum, o) => sum + (o.lineCount || 0), 0);

          return {
            name: f.name,
            signature: f.signature || `function ${f.name}()`,
            sizeBytes: actualSize,
            sizeFormatted: formatBytes(actualSize),
            avgSizeBytes: f.avgSizeBytes || Math.round(actualSize / (occurrences.length || 1)),
            avgSizeFormatted: formatBytes(f.avgSizeBytes || Math.round(actualSize / (occurrences.length || 1))),
            totalLines,
            occurrences: occurrences.map(o => ({
              file: o.file,
              relativePath: o.relativePath || o.file,
              line: o.line,
              endLine: o.endLine,
              lineCount: o.lineCount || 0,
              sizeBytes: o.sizeBytes || 0,
              sizeFormatted: formatBytes(o.sizeBytes || 0)
            })),
            similarity: f.similarity || 100,
            recommendation: f.recommendation || {
              action: 'Consolidate into single function',
              confidence: actualSize > 1000 ? 'high' : 'medium'
            }
          };
        }),
        quickWins: duplicates.quickWins || []
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === Licenses Analysis ===

  // Get full license compliance analysis
  router.get('/drill/licenses/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const licenses = scanData.licenses || scanData.details?.licenses || {};
      const byLicense = licenses.byLicense || {};

      // Categorise licenses by risk
      const riskCategories = {
        high: ['GPL', 'AGPL', 'LGPL', 'SSPL', 'CC-BY-NC', 'CC-BY-ND'],
        medium: ['MPL', 'EPL', 'CDDL', 'EUPL', 'OSL'],
        low: ['MIT', 'ISC', 'BSD', 'Apache', 'Unlicense', 'CC0', 'WTFPL', '0BSD']
      };

      const categorised = {
        high: [],
        medium: [],
        low: [],
        unknown: []
      };

      const licenseDetails = [];

      for (const [license, packages] of Object.entries(byLicense)) {
        const upperLicense = license.toUpperCase();
        let risk = 'unknown';
        let riskReason = 'License not recognised';

        if (riskCategories.high.some(l => upperLicense.includes(l))) {
          risk = 'high';
          riskReason = 'Copyleft license - may require source disclosure';
        } else if (riskCategories.medium.some(l => upperLicense.includes(l))) {
          risk = 'medium';
          riskReason = 'Weak copyleft - file-level requirements';
        } else if (riskCategories.low.some(l => upperLicense.includes(l))) {
          risk = 'low';
          riskReason = 'Permissive license - minimal restrictions';
        }

        const pkgList = packages;
        categorised[risk].push(...pkgList.map(p => ({ package: p, license })));

        licenseDetails.push({
          license,
          count: pkgList.length,
          packages: pkgList,
          risk,
          riskReason,
          compliance: {
            attribution: !['Unlicense', 'CC0', 'WTFPL'].some(l => upperLicense.includes(l)),
            sourceDisclosure: riskCategories.high.some(l => upperLicense.includes(l)),
            modifications: riskCategories.high.some(l => upperLicense.includes(l)) || riskCategories.medium.some(l => upperLicense.includes(l))
          }
        });
      }

      const totalPackages = Object.values(byLicense).flat().length;

      res.json({
        success: true,
        headline: licenses.headline || `${totalPackages} packages across ${Object.keys(byLicense).length} license types`,
        summary: {
          totalPackages,
          totalLicenses: Object.keys(byLicense).length,
          highRisk: categorised.high.length,
          mediumRisk: categorised.medium.length,
          lowRisk: categorised.low.length,
          unknown: categorised.unknown.length,
          compliant: categorised.high.length === 0
        },
        byLicense: licenseDetails.sort((a, b) => {
          const riskOrder = { high: 0, medium: 1, unknown: 2, low: 3 };
          return riskOrder[a.risk] - riskOrder[b.risk];
        }),
        byRisk: {
          high: categorised.high,
          medium: categorised.medium,
          low: categorised.low,
          unknown: categorised.unknown
        },
        recommendations: licenses.recommendations || buildLicenseRecommendations(categorised)
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Helper for license recommendations
  function buildLicenseRecommendations(categorised) {
    const recommendations = [];

    if (categorised.high.length > 0) {
      recommendations.push({
        priority: 'high',
        title: `Review ${categorised.high.length} high-risk license(s)`,
        description: 'These packages use copyleft licenses that may require you to disclose your source code.',
        packages: categorised.high.slice(0, 5).map(p => p.package),
        action: 'Consult legal team or consider alternatives'
      });
    }

    if (categorised.unknown.length > 0) {
      recommendations.push({
        priority: 'medium',
        title: `Identify ${categorised.unknown.length} unknown license(s)`,
        description: 'These packages have unrecognised licenses that should be reviewed.',
        packages: categorised.unknown.slice(0, 5).map(p => p.package),
        action: 'Manually verify license terms'
      });
    }

    return recommendations;
  }

  // === Heavy Dependencies ===

  // Get dependencies by size
  router.get('/drill/heavy-deps/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const heavyDeps = scanData.heavyDeps || scanData.details?.heavyDeps || [];
      const dependencies = scanData.dependencies || scanData.details?.dependencies || {};
      const summary = scanData.summary || {};

      // If heavyDeps is empty, try to build from dependencies data
      let depsList = heavyDeps;
      if (depsList.length === 0 && dependencies.installed) {
        depsList = Object.entries(dependencies.installed)
          .map(([name, info]) => ({
            name,
            version: info.version,
            sizeBytes: info.sizeBytes || 0,
            dependencies: info.dependencies?.length || 0
          }))
          .sort((a, b) => b.sizeBytes - a.sizeBytes)
          .slice(0, 50);
      }

      const totalDepSize = depsList.reduce((sum, d) => sum + (d.sizeBytes || 0), 0);
      const totalDeps = summary.dependencyCount || depsList.length;

      // Find alternatives for heavy deps
      const heavyWithAlternatives = depsList.slice(0, 20).map(dep => {
        const alternatives = dep.alternatives || findLighterAlternatives(dep.name);
        return {
          name: dep.name,
          version: dep.version,
          sizeBytes: dep.sizeBytes || 0,
          sizeFormatted: formatBytes(dep.sizeBytes || 0),
          percentage: totalDepSize > 0 ? ((dep.sizeBytes || 0) / totalDepSize * 100).toFixed(1) : '0',
          dependencies: dep.dependencies || 0,
          alternatives,
          recommendation: dep.recommendation || (alternatives.length > 0 ? {
            action: 'Consider lighter alternative',
            confidence: 'medium'
          } : null)
        };
      });

      res.json({
        success: true,
        headline: `${totalDeps} dependencies, ${formatBytes(totalDepSize)} total`,
        summary: {
          totalDependencies: totalDeps,
          totalSize: formatBytes(totalDepSize),
          totalSizeBytes: totalDepSize,
          top10Size: formatBytes(depsList.slice(0, 10).reduce((s, d) => s + (d.sizeBytes || 0), 0)),
          top10Percentage: totalDepSize > 0
            ? (depsList.slice(0, 10).reduce((s, d) => s + (d.sizeBytes || 0), 0) / totalDepSize * 100).toFixed(1)
            : '0'
        },
        dependencies: heavyWithAlternatives,
        quickWins: buildHeavyDepsQuickWins(heavyWithAlternatives)
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Helper for finding lighter alternatives
  function findLighterAlternatives(packageName) {
    const alternatives = {
      'moment': [{ name: 'dayjs', savings: '95%' }, { name: 'date-fns', savings: '70%' }],
      'lodash': [{ name: 'lodash-es', savings: '60%' }, { name: 'ramda', savings: '40%' }],
      'axios': [{ name: 'ky', savings: '80%' }, { name: 'fetch (native)', savings: '100%' }],
      'request': [{ name: 'node-fetch', savings: '90%' }, { name: 'got', savings: '50%' }],
      'underscore': [{ name: 'lodash-es', savings: '30%' }],
      'jquery': [{ name: 'cash-dom', savings: '90%' }, { name: 'vanilla JS', savings: '100%' }],
      'bluebird': [{ name: 'native Promise', savings: '100%' }],
      'uuid': [{ name: 'nanoid', savings: '60%' }, { name: 'crypto.randomUUID()', savings: '100%' }],
      'chalk': [{ name: 'picocolors', savings: '95%' }, { name: 'kleur', savings: '90%' }],
      'commander': [{ name: 'cac', savings: '70%' }, { name: 'mri', savings: '95%' }]
    };
    return alternatives[packageName] || [];
  }

  // Helper for heavy deps quick wins
  function buildHeavyDepsQuickWins(deps) {
    const quickWins = [];
    const withAlternatives = deps.filter(d => d.alternatives?.length > 0);

    if (withAlternatives.length > 0) {
      quickWins.push({
        type: 'replace-heavy',
        title: `Replace ${withAlternatives.length} heavy package(s) with lighter alternatives`,
        packages: withAlternatives.slice(0, 5).map(d => ({
          from: d.name,
          to: d.alternatives[0]?.name,
          savings: d.alternatives[0]?.savings
        })),
        effort: 'medium'
      });
    }

    return quickWins;
  }

  // === Log Analysis ===

  // Get log file analysis
  router.get('/drill/logs/:scanId', async (req, res) => {
    try {
      const scan = await getScanById(req.params.scanId);
      if (!scan) {
        return res.status(404).json({ success: false, error: 'Scan not found' });
      }

      const scanData = typeof scan.raw_data === 'string' ? JSON.parse(scan.raw_data) : scan.raw_data || scan;
      const logAnalysis = scanData.details?.logAnalysis || {
        summary: { totalLogBytes: 0, logFileCount: 0, logDirectoryCount: 0 },
        logFiles: [],
        logDirectories: [],
        findings: [],
        hasIssues: false
      };

      const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };

      res.json({
        success: true,
        headline: logAnalysis.hasIssues
          ? `${logAnalysis.summary.totalLogFormatted || formatBytes(logAnalysis.summary.totalLogBytes)} of logs detected`
          : 'No log file issues detected',
        summary: logAnalysis.summary,
        logFiles: logAnalysis.logFiles || [],
        logDirectories: logAnalysis.logDirectories || [],
        findings: logAnalysis.findings || [],
        hasIssues: logAnalysis.hasIssues,
        // New structured solutions format
        solutions: logAnalysis.findings?.map(f => ({
          issue: f.message,
          severity: f.severity,
          files: f.files || [],
          immediate: f.solutions?.immediate || null,
          permanent: f.solutions?.permanent || null,
          // Legacy fallback
          action: f.recommendation?.action || f.solutions?.permanent?.title,
          commands: f.recommendation?.commands || f.solutions?.immediate?.commands || [],
          priority: f.priority || f.recommendation?.priority || 'medium',
          effort: f.effort || f.recommendation?.effort || 'low'
        })) || []
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === Configuration ===

  // Get project configuration (merged from defaults, global, project, and database)
  router.get('/config/:projectPath(*)', async (req, res) => {
    try {
      const projectPath = decodeURIComponent(req.params.projectPath);
      const projectExistsLocally = existsSync(projectPath);

      // Load file-based config (will use defaults if project doesn't exist)
      const config = await loadConfig(null, projectExistsLocally ? projectPath : process.cwd());
      const sources = config._sources || ['defaults'];

      // For remote projects, also load from database
      if (!projectExistsLocally) {
        const dbConfig = await getProjectConfigFromDb(projectPath);
        if (Object.keys(dbConfig).length > 0) {
          // Merge database config over file config
          if (dbConfig.costs) config.costs = { ...config.costs, ...dbConfig.costs };
          if (dbConfig.emissions) config.emissions = { ...config.emissions, ...dbConfig.emissions };
          if (dbConfig.ci) config.ci = { ...config.ci, ...dbConfig.ci };
          sources.push('database');
        }
      }

      res.json({
        success: true,
        config: {
          costs: config.costs,
          emissions: config.emissions,
          ci: config.ci
        },
        source: sources.join(' < '),
        sources,
        defaults: {
          costs: DEFAULT_COSTS
        },
        isRemote: !projectExistsLocally
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Save project configuration
  // For local projects: saves to .swynx.json
  // For remote projects: saves to local database
  router.post('/config/:projectPath(*)', async (req, res) => {
    try {
      const projectPath = decodeURIComponent(req.params.projectPath);
      const { costs, emissions, ci } = req.body;
      const projectExistsLocally = existsSync(projectPath);

      // Build config object with only provided sections
      const configToSave = {};
      if (costs) configToSave.costs = costs;
      if (emissions) configToSave.emissions = emissions;
      if (ci) configToSave.ci = ci;

      if (projectExistsLocally) {
        // Save to .swynx.json file in project directory
        const result = await saveProjectConfig(projectPath, configToSave);
        res.json({
          success: true,
          path: result.path,
          message: 'Configuration saved to .swynx.json'
        });
      } else {
        // Save to local database for remote projects
        await saveProjectConfigToDb(projectPath, configToSave);
        res.json({
          success: true,
          path: 'database',
          message: 'Configuration saved to local database (project is remote)'
        });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === License ===

  // Check project license
  router.get('/license/check', async (req, res) => {
    try {
      const projectPath = req.query.project;
      if (!projectPath) {
        return res.status(400).json({ success: false, error: 'project query param required' });
      }
      const result = await checkProjectLicense(projectPath);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get license status
  router.get('/license/status', async (req, res) => {
    try {
      const status = await getLicenseStatus();
      // Also include registered projects info
      const slotInfo = await getSlotInfo();
      res.json({
        success: true,
        ...status,
        slots: slotInfo
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Activate license key (offline-capable)
  router.post('/license/activate', async (req, res) => {
    try {
      const { licenseKey, email } = req.body;

      if (!licenseKey) {
        return res.status(400).json({
          success: false,
          error: 'licenseKey is required'
        });
      }

      // Validate license key format: SWYX-XXXX-XXXX-XXXX-XXXX or TRIAL-XXXX-XXXX-XXXX-XXXX
      const normalized = licenseKey.trim().toUpperCase();
      const match = normalized.match(/^(SWYX|TRIAL)-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/);

      if (!match) {
        return res.status(400).json({
          success: false,
          error: 'Invalid license key format. Expected: SWYX-XXXX-XXXX-XXXX-XXXX'
        });
      }

      const prefix = match[1];
      const isTrial = prefix === 'TRIAL';

      // Create license data (offline activation)
      const licenseData = {
        licenseKey: normalized,
        email: email || 'activated@local',
        tier: isTrial ? 'trial' : 'enterprise',
        tierName: isTrial ? 'Trial' : 'Enterprise',
        maxProjects: isTrial ? 3 : -1, // -1 = unlimited
        expires: isTrial
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // 30 days
          : '2099-12-31',
        activatedAt: new Date().toISOString(),
        cicdEnabled: !isTrial,
        projects: []
      };

      // Save license
      await saveLicense(licenseData);

      // Get updated status
      const status = await getLicenseStatus();

      res.json({
        success: true,
        message: 'License activated successfully',
        license: status
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Store license key directly (for pre-filled keys from install)
  router.post('/license/store', async (req, res) => {
    try {
      const { licenseData } = req.body;

      if (!licenseData) {
        return res.status(400).json({
          success: false,
          error: 'licenseData is required'
        });
      }

      await saveLicense(licenseData);

      res.json({
        success: true,
        message: 'License stored successfully'
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === Version & Update ===

  // Get current version info
  router.get('/version', (req, res) => {
    res.json({
      success: true,
      version: VERSION,
      ...getVersionInfo()
    });
  });

  // Check for updates
  router.get('/update/check', async (req, res) => {
    try {
      // Force check to bypass rate limiting when dashboard explicitly requests
      const update = await checkForUpdate(true, true);

      if (update) {
        res.json({
          success: true,
          updateAvailable: true,
          currentVersion: update.currentVersion,
          latestVersion: update.latestVersion,
          releaseNotes: update.releaseNotes,
          changelog: update.changelog
        });
      } else {
        res.json({
          success: true,
          updateAvailable: false,
          currentVersion: VERSION
        });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Install update (one-click from dashboard)
  router.post('/update/install', async (req, res) => {
    try {
      // First check if update is available
      const update = await checkForUpdate(true, true);

      if (!update) {
        return res.json({
          success: true,
          updated: false,
          message: 'Already on latest version',
          version: VERSION
        });
      }

      // Send response before installing (so dashboard knows it's happening)
      res.json({
        success: true,
        updating: true,
        fromVersion: update.currentVersion,
        toVersion: update.latestVersion,
        message: 'Installing update... Dashboard will reconnect automatically.'
      });

      // Install update after response is sent
      // Small delay to ensure response is flushed
      setTimeout(async () => {
        try {
          const installed = await installUpdate({ silent: true });

          if (installed) {
            // Exit gracefully - systemd/pm2 will restart, or user restarts manually
            console.log('\n Update installed. Restarting...\n');
            process.exit(0);
          }
        } catch (error) {
          console.error('Update installation failed:', error.message);
        }
      }, 100);

    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === System Info ===

  router.get('/system-info', (req, res) => {
    try {
      const cpuCount = availableParallelism();
      const totalMemoryGb = Math.round(totalmem() / (1024 * 1024 * 1024) * 10) / 10;
      const freeMemoryGb = Math.round(freemem() / (1024 * 1024 * 1024) * 10) / 10;

      // Suggest workers: leave 2 cores for OS/dashboard, min 1, max 8
      const suggested = Math.max(1, Math.min(cpuCount - 2, 8));

      // Memory warning: each worker uses ~200-400MB for large repos
      const maxSafeWorkers = Math.max(1, Math.floor(freeMemoryGb / 0.5));

      res.json({
        success: true,
        cpuCount,
        totalMemoryGb,
        freeMemoryGb,
        suggestedWorkers: Math.min(suggested, maxSafeWorkers),
        maxWorkers: Math.min(cpuCount, 8),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === Settings ===

  // Get all settings
  router.get('/settings', (req, res) => {
    try {
      const settings = getSettings();
      res.json({ success: true, settings });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Update settings
  router.post('/settings', (req, res) => {
    try {
      const { settings } = req.body;

      if (!settings) {
        return res.status(400).json({
          success: false,
          error: 'settings object is required'
        });
      }

      saveSettings(settings);

      res.json({
        success: true,
        message: 'Settings saved successfully',
        settings: getSettings()
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // === Swynx Engine (AI Qualification) ===

  // Get engine status
  router.get('/ai/status', async (req, res) => {
    try {
      const { getEngineStatus } = await import('../../../../swynx/src/ai/engine.mjs');
      const status = await getEngineStatus();
      res.json({ success: true, ...status });
    } catch (error) {
      res.json({
        success: true,
        name: 'Swynx Engine',
        installed: false,
        running: false,
        modelReady: false,
        ready: false,
        error: error.message
      });
    }
  });

  // Warm up the model (call this in background to speed up first qualification)
  router.post('/ai/warm', async (req, res) => {
    try {
      const { warmModel } = await import('../../../../swynx/src/ai/ollama.mjs');
      await warmModel();
      res.json({ success: true, message: 'Model warmed' });
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  });

  // Setup/install engine (SSE for progress)
  router.get('/ai/setup', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const { ensureEngine } = await import('../../../../swynx/src/ai/engine.mjs');

      const result = await ensureEngine(({ stage, message, progress }) => {
        res.write(`data: ${JSON.stringify({ stage, message, progress })}\n\n`);
      });

      res.write(`data: ${JSON.stringify({ stage: 'done', ...result })}\n\n`);
    } catch (error) {
      res.write(`data: ${JSON.stringify({ stage: 'error', message: error.message })}\n\n`);
    }

    res.end();
  });

  // Qualify dead files from a scan
  router.post('/ai/qualify', async (req, res) => {
    try {
      const { scanId, projectPath, deadFiles } = req.body;

      if (!deadFiles || !Array.isArray(deadFiles)) {
        return res.status(400).json({ success: false, error: 'deadFiles array required' });
      }

      const { qualify } = await import('../../../../swynx/src/ai/qualifier.mjs');

      // Build minimal results object for qualifier
      const results = {
        totalFiles: req.body.totalFiles || 0,
        deadFiles: deadFiles.map(f => ({
          path: f.path || f.file,
          size: f.size || 0,
          lines: f.lines || 0,
          language: f.language || 'javascript',
          exports: f.exports || []
        }))
      };

      const qualified = await qualify(results, { projectPath }, {
        qualifyLimit: req.body.limit || 50,
        verbose: false
      });

      res.json({
        success: true,
        deadFiles: qualified.deadFiles,
        aiSummary: qualified.aiSummary
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Qualify with SSE progress (for real-time updates)
  router.post('/ai/qualify/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const { projectPath, deadFiles } = req.body;

      if (!deadFiles || !Array.isArray(deadFiles)) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'deadFiles array required' })}\n\n`);
        return res.end();
      }

      const { ensureEngine } = await import('../../../../swynx/src/ai/engine.mjs');
      const { qualify } = await import('../../../../swynx/src/ai/qualifier.mjs');

      // Ensure engine is ready first
      res.write(`data: ${JSON.stringify({ type: 'status', message: 'Checking Swynx Engine...' })}\n\n`);

      const engineResult = await ensureEngine(({ stage, message }) => {
        res.write(`data: ${JSON.stringify({ type: 'setup', stage, message })}\n\n`);
      });

      if (!engineResult.ready) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: engineResult.message })}\n\n`);
        return res.end();
      }

      res.write(`data: ${JSON.stringify({ type: 'status', message: 'Qualifying dead files...' })}\n\n`);

      const results = {
        totalFiles: req.body.totalFiles || 0,
        deadFiles: deadFiles.map(f => ({
          path: f.path || f.file,
          size: f.size || 0,
          lines: f.lines || 0,
          language: f.language || 'javascript',
          exports: f.exports || []
        }))
      };

      const qualified = await qualify(results, { projectPath }, {
        qualifyLimit: req.body.limit || 50,
        verbose: false
      });

      // Send individual file results
      for (const file of qualified.deadFiles) {
        if (file.aiQualification) {
          res.write(`data: ${JSON.stringify({
            type: 'file',
            path: file.path,
            qualification: file.aiQualification
          })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({
        type: 'complete',
        aiSummary: qualified.aiSummary
      })}\n\n`);
    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    }

    res.end();
  });

  return router;
}

export default { createRoutes };
