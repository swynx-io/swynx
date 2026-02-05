// src/cli/commands/quarantine.mjs
// Quarantine command implementation

import {
  listSessions,
  getSession,
  restoreSession,
  purgeSession,
  getQuarantineSize
} from '../../fixer/quarantine.mjs';

export async function quarantineCommand(action, projectPath = process.cwd(), options) {
  switch (action) {
    case 'list':
      await listAction(projectPath);
      break;

    case 'show':
      await showAction(projectPath, options.session);
      break;

    case 'restore':
      await restoreAction(projectPath, options);
      break;

    case 'purge':
      await purgeAction(projectPath, options);
      break;

    default:
      console.log('\n Quarantine Management\n');
      console.log(' Commands:');
      console.log('   list [path]                List quarantine sessions');
      console.log('   show [path] -s <id>        Show session details');
      console.log('   restore [path] -s <id>     Restore files from quarantine');
      console.log('   purge [path] -s <id>       Permanently delete quarantined files');
      console.log('   purge [path] --old <days>  Purge sessions older than N days');
      console.log('');
  }
}

async function listAction(projectPath) {
  const sessions = listSessions(projectPath);

  if (sessions.length === 0) {
    console.log('\n No quarantine sessions found\n');
    return;
  }

  console.log('\n Quarantine Sessions\n');

  for (const session of sessions) {
    const date = new Date(session.createdAt).toLocaleDateString();
    const status = session.status === 'restored' ? '[RESTORED]' : '';
    console.log(` ${session.sessionId}`);
    console.log(`   Date:   ${date}`);
    console.log(`   Reason: ${session.reason}`);
    console.log(`   Files:  ${session.fileCount}`);
    console.log(`   Size:   ${formatBytes(session.totalSize)} ${status}`);
    console.log('');
  }

  const totalSize = getQuarantineSize(projectPath);
  console.log(` Total quarantine size: ${formatBytes(totalSize)}\n`);
}

async function showAction(projectPath, sessionId) {
  if (!sessionId) {
    console.error('\n Session ID required. Use -s <session-id>\n');
    process.exit(1);
  }

  const session = getSession(projectPath, sessionId);

  if (!session) {
    console.error(`\n Session ${sessionId} not found\n`);
    process.exit(1);
  }

  console.log('\n Quarantine Session Details\n');
  console.log(` Session ID: ${session.sessionId}`);
  console.log(` Created:    ${new Date(session.createdAt).toLocaleString()}`);
  console.log(` Reason:     ${session.reason}`);
  console.log(` Status:     ${session.status}`);
  console.log(` Files:      ${session.fileCount}`);
  console.log(` Total Size: ${formatBytes(session.totalSize)}`);
  console.log('');

  if (session.files.length > 0) {
    console.log(' Files:');
    for (const file of session.files.slice(0, 30)) {
      console.log(`   ${file.originalPath} (${formatBytes(file.size)})`);
    }
    if (session.files.length > 30) {
      console.log(`   ... and ${session.files.length - 30} more`);
    }
    console.log('');
  }
}

async function restoreAction(projectPath, options) {
  const sessionId = options.session;

  if (!sessionId) {
    console.error('\n Session ID required. Use -s <session-id>\n');
    process.exit(1);
  }

  console.log(`\n Restoring session ${sessionId}...\n`);

  try {
    const result = restoreSession(projectPath, sessionId);
    console.log(` ${result.message}\n`);

    if (result.errors && result.errors.length > 0) {
      console.log(' Some files could not be restored:');
      for (const err of result.errors) {
        console.log(`   ${err.file}: ${err.error}`);
      }
      console.log('');
    }
  } catch (error) {
    console.error(` Restore failed: ${error.message}\n`);
    process.exit(1);
  }
}

async function purgeAction(projectPath, options) {
  // Purge old sessions
  if (options.old) {
    const days = parseInt(options.old, 10);
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

    const sessions = listSessions(projectPath);
    const oldSessions = sessions.filter(s => new Date(s.createdAt).getTime() < cutoff);

    if (oldSessions.length === 0) {
      console.log(`\n No sessions older than ${days} days\n`);
      return;
    }

    if (!options.force) {
      console.log(`\n Found ${oldSessions.length} session(s) older than ${days} days.`);
      console.log(' Use --force to permanently delete them.\n');
      return;
    }

    console.log(`\n Purging ${oldSessions.length} old session(s)...\n`);

    let purged = 0;
    for (const session of oldSessions) {
      try {
        purgeSession(projectPath, session.sessionId);
        purged++;
      } catch (e) {
        console.error(` Failed to purge ${session.sessionId}: ${e.message}`);
      }
    }

    console.log(` Purged ${purged} session(s)\n`);
    return;
  }

  // Purge specific session
  const sessionId = options.session;

  if (!sessionId) {
    console.error('\n Session ID required. Use -s <session-id>\n');
    process.exit(1);
  }

  if (!options.force) {
    console.log('\n WARNING: This will permanently delete quarantined files.');
    console.log(' Use --force to confirm.\n');
    return;
  }

  console.log(`\n Purging session ${sessionId}...\n`);

  try {
    const result = purgeSession(projectPath, sessionId);
    console.log(` ${result.message}\n`);
  } catch (error) {
    console.error(` Purge failed: ${error.message}\n`);
    process.exit(1);
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

export default quarantineCommand;
