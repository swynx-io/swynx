/**
 * Integration API Routes
 *
 * Express sub-router for Git platform integrations.
 * Mounted at /api/integrations/ in the main router.
 */

import { Router } from 'express';
import {
  getSupportedPlatforms,
  getConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
  testConnection,
  listRepos
} from '../../integrations/index.mjs';
import { cloneAndScan } from '../../integrations/clone.mjs';
import { postFeedback } from '../../integrations/feedback.mjs';
import { getScanById } from '../../storage/index.mjs';
import { getSetting } from '../../config/store.mjs';

export function createIntegrationRoutes() {
  const router = Router();

  // ── Platforms ──────────────────────────────────────

  // List supported platforms with credential field schemas
  router.get('/platforms', (req, res) => {
    try {
      const platforms = getSupportedPlatforms();
      res.json({ success: true, platforms });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Connections CRUD ──────────────────────────────

  // List all connections (tokens masked)
  router.get('/connections', (req, res) => {
    try {
      const connections = getConnections();
      res.json({ success: true, connections });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Create a new connection
  router.post('/connections', (req, res) => {
    try {
      const result = createConnection(req.body);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Update a connection
  router.put('/connections/:id', (req, res) => {
    try {
      const result = updateConnection(req.params.id, req.body);
      if (!result.success) {
        return res.status(404).json(result);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Delete a connection
  router.delete('/connections/:id', (req, res) => {
    try {
      const result = deleteConnection(req.params.id);
      if (!result.success) {
        return res.status(404).json(result);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Test a connection
  router.post('/connections/:id/test', async (req, res) => {
    try {
      const result = await testConnection(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // List repos for a connection
  router.get('/connections/:id/repos', async (req, res) => {
    try {
      const { page, per_page, search } = req.query;
      const result = await listRepos(req.params.id, {
        page: parseInt(page) || 1,
        perPage: parseInt(per_page) || 25,
        search: search || undefined
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Scan ──────────────────────────────────────────

  // Clone + scan with SSE progress streaming
  router.get('/scan-stream/:connectionId/:repoSlug(*)', async (req, res) => {
    const { connectionId, repoSlug } = req.params;
    const branch = req.query.branch || undefined;

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

    // Heartbeat
    let lastPhase = '';
    let heartbeatCount = 0;
    const heartbeatInterval = setInterval(() => {
      if (lastPhase) {
        heartbeatCount++;
        const dots = '.'.repeat((heartbeatCount % 3) + 1);
        res.write(`data: ${JSON.stringify({
          type: 'progress', phase: lastPhase, detail: `Processing${dots}`,
          heartbeat: true, timestamp: Date.now()
        })}\n\n`);
      }
    }, 1500);

    const onProgress = (progress) => {
      lastPhase = progress.phase || lastPhase;
      res.write(`data: ${JSON.stringify({
        type: 'progress',
        phase: progress.phase,
        percent: Math.round(progress.percent || 0),
        detail: progress.detail || '',
        current: progress.current || 0,
        total: progress.total || 0,
        timestamp: Date.now()
      })}\n\n`);
    };

    try {
      const scanResult = await cloneAndScan(connectionId, repoSlug, { onProgress, branch });

      res.write(`data: ${JSON.stringify({
        type: 'complete',
        scan: scanResult,
        timestamp: Date.now()
      })}\n\n`);
    } catch (err) {
      console.error('[integration-scan-stream] Error:', err.message);
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: err.message,
        timestamp: Date.now()
      })}\n\n`);
    } finally {
      clearInterval(heartbeatInterval);
      res.end();
    }
  });

  // Clone + scan (blocking, returns result directly)
  router.post('/scan', async (req, res) => {
    const { connectionId, repoSlug, branch } = req.body;

    if (!connectionId || !repoSlug) {
      return res.status(400).json({
        success: false,
        error: 'connectionId and repoSlug are required'
      });
    }

    try {
      const scanResult = await cloneAndScan(connectionId, repoSlug, { branch });
      res.json({ success: true, scan: scanResult });
    } catch (err) {
      console.error('[integration-scan] Error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── PR Feedback ───────────────────────────────────

  // Post scan results to a PR/MR
  router.post('/feedback', async (req, res) => {
    const { connectionId, repoSlug, prNumber, sha, scanId } = req.body;

    if (!connectionId || !repoSlug || !prNumber) {
      return res.status(400).json({
        success: false,
        error: 'connectionId, repoSlug, and prNumber are required'
      });
    }

    try {
      let scanResult;
      if (scanId) {
        scanResult = await getScanById(scanId);
        if (!scanResult) {
          return res.status(404).json({ success: false, error: 'Scan not found' });
        }
      } else {
        return res.status(400).json({
          success: false,
          error: 'scanId is required (pass the scan ID from a previous scan)'
        });
      }

      const result = await postFeedback({ connectionId, repoSlug, prNumber, sha, scanResult });
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('[integration-feedback] Error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
