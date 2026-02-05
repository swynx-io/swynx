// src/cli/commands/dashboard.mjs
// Dashboard command implementation

import { startDashboard } from '../../dashboard/server.mjs';

export async function dashboardCommand(options) {
  const port = parseInt(options.port, 10) || 9000;
  const openBrowser = options.openBrowser !== false;

  await startDashboard({
    port,
    openBrowser
  });
}

export default dashboardCommand;
