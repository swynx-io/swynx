// src/dashboard/server.mjs

import express from 'express';
import { join, dirname } from 'path';
import { networkInterfaces, platform } from 'os';
import { existsSync, readdirSync, statSync } from 'fs';
import { exec } from 'child_process';
import { createRoutes } from './api/routes.mjs';
import { DATA_DIR } from '../config/index.mjs';

/**
 * Open URL in default browser
 */
function openBrowser(url) {
  const plat = platform();
  let command;

  switch (plat) {
    case 'darwin':
      command = `open "${url}"`;
      break;
    case 'win32':
      command = `start "" "${url}"`;
      break;
    default:
      // Linux and others
      command = `xdg-open "${url}" || sensible-browser "${url}" || x-www-browser "${url}"`;
  }

  exec(command, (err) => {
    if (err) {
      console.log(`  Could not auto-open browser. Please visit: ${url}`);
    }
  });
}

// Get __dirname in a way that works for both ESM and bundled CJS
function getPublicDir() {
  // Check common locations for public directory
  const locations = [
    join(DATA_DIR, 'public'),               // Primary: DATA_DIR/public (works for both systemd and user)
    '/var/lib/swynx/public',                 // Fallback: explicit systemd path
    join(process.cwd(), 'src/dashboard/public'),
    join(process.cwd(), 'public'),
    join(dirname(process.argv[1]), 'public'),
    join(dirname(process.argv[1]), '../src/dashboard/public'),
    join(dirname(process.argv[1]), '../public')
  ];

  for (const loc of locations) {
    if (existsSync(join(loc, 'index.html'))) {
      return loc;
    }
  }

  // Fallback
  return join(process.cwd(), 'src/dashboard/public');
}

const publicDir = getPublicDir();

/**
 * Start the dashboard server
 */
export async function startDashboard(options = {}) {
  const port = options.port || 8999;
  const app = express();

  // Middleware
  app.use(express.json());

  // API routes
  app.use('/api', await createRoutes());

  // Serve static files
  app.use(express.static(publicDir));

  // Serve downloads (release packages)
  const releasesDir = join(dirname(process.argv[1]), '../dist/releases');
  const scriptsDir = join(dirname(process.argv[1]), '../../scripts');

  // Serve install.sh at root for easy curl install
  app.get('/install.sh', (req, res) => {
    const installScript = join(scriptsDir, 'install.sh');
    if (existsSync(installScript)) {
      res.type('text/plain').sendFile(installScript);
    } else {
      res.status(404).send('Install script not found');
    }
  });

  if (existsSync(releasesDir)) {
    app.use('/downloads', express.static(releasesDir));
    app.use('/releases', express.static(releasesDir));  // Also serve at /releases for install.sh

    // List available downloads
    app.get('/api/downloads', (req, res) => {
      const files = [];
      try {
        const entries = readdirSync(releasesDir);
        for (const file of entries) {
          const stat = statSync(join(releasesDir, file));
          if (stat.isFile()) {
            files.push({
              name: file,
              size: stat.size,
              sizeFormatted: (stat.size / 1024 / 1024).toFixed(1) + ' MB',
              url: `/downloads/${file}`
            });
          }
        }
      } catch (e) {}
      res.json({ success: true, files });
    });
  }

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });

  // Start server - bind to 0.0.0.0 for network access
  const host = options.host || '0.0.0.0';
  const server = app.listen(port, host, () => {
    // Get server IP for display (skip Docker/internal IPs)
    const interfaces = networkInterfaces();
    let serverIp = 'localhost';
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          // Skip Docker and private network IPs
          if (!iface.address.startsWith('172.') && !iface.address.startsWith('10.')) {
            serverIp = iface.address;
            break;
          }
        }
      }
      if (serverIp !== 'localhost') break;
    }

    const localUrl = `http://localhost:${port}`;

    console.log(`
  Swynx Dashboard running at:

    Local:   ${localUrl}
    Network: http://${serverIp}:${port}

  Press Ctrl+C to stop
    `);

    // Auto-open browser if requested
    if (options.openBrowser !== false) {
      openBrowser(localUrl);
    }

    // Pre-warm AI model in background and keep it warm
    (async () => {
      try {
        const { warmModel } = await import('../ai/ollama.mjs');
        await warmModel();
        console.log('  Swynx Engine: Model pre-warmed ✓');

        // Keep model warm every 2 minutes (Ollama unloads after 5min idle)
        setInterval(async () => {
          try {
            await warmModel();
          } catch { /* ignore */ }
        }, 2 * 60 * 1000);
      } catch (e) {
        // AI not available, skip silently
      }
    })();
  });

  return server;
}

export default startDashboard;

// Only auto-start when run directly (not when imported)
// Check if this is the main module by checking process.argv
const isMainModule = process.argv[1]?.endsWith('server.mjs') || process.argv[1]?.includes('dashboard/server');
if (isMainModule) {
  const port = parseInt(process.env.PORT) || 8999;
  startDashboard({ port }).catch(err => {
    console.error('Failed to start dashboard:', err.message);
    process.exit(1);
  });
}
