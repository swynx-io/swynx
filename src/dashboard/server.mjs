// src/dashboard/server.mjs - Swynx Dashboard Server

import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { networkInterfaces, platform } from 'os';
import { existsSync } from 'fs';
import { exec } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
      command = `xdg-open "${url}" || sensible-browser "${url}" || x-www-browser "${url}"`;
  }

  exec(command, (err) => {
    if (err) {
      console.log(`  Could not auto-open browser. Please visit: ${url}`);
    }
  });
}

function getPublicDir() {
  const locations = [
    join(__dirname, 'public'),
    join(process.cwd(), 'src/dashboard/public'),
    join(process.cwd(), 'public'),
  ];

  for (const loc of locations) {
    if (existsSync(join(loc, 'index.html'))) {
      return loc;
    }
  }

  return join(__dirname, 'public');
}

/**
 * Start the dashboard server
 */
export async function startDashboard(options = {}) {
  const port = options.port || 8999;
  const app = express();
  const publicDir = getPublicDir();

  // Middleware
  app.use(express.json());

  // API routes
  const { createRoutes } = await import('./api/routes.mjs');
  app.use('/api', await createRoutes());

  // Serve static files
  app.use(express.static(publicDir));

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });

  // Start server - bind to 0.0.0.0 for network access
  const host = options.host || '0.0.0.0';

  return new Promise((resolve) => {
    const server = app.listen(port, host, async () => {
      // Get server IP for display
      const interfaces = networkInterfaces();
      let serverIp = 'localhost';
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
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

      // Pre-warm AI model in background
      try {
        const { warmModel } = await import('../ai/ollama.mjs');
        await warmModel();
        console.log('  Swynx Engine: Model pre-warmed ✓');
      } catch (e) {
        // AI not available, skip silently
      }

      // Auto-open browser if requested
      if (options.openBrowser !== false) {
        openBrowser(localUrl);
      }

      resolve(server);
    });
  });
}

export default startDashboard;

// Auto-start when run directly
const isMainModule = process.argv[1]?.endsWith('server.mjs') || process.argv[1]?.includes('dashboard/server');
if (isMainModule) {
  const port = parseInt(process.env.PORT) || 8999;
  startDashboard({ port }).catch(err => {
    console.error('Failed to start dashboard:', err.message);
    process.exit(1);
  });
}
