/**
 * Perforce Platform Integration
 *
 * Basic support via Git Fusion bridge.
 * Uses P4 user + ticket for authentication.
 * No native PR feedback — Perforce uses changelists, not PRs.
 */

import { execSync } from 'child_process';

export default {
  id: 'perforce',
  name: 'Perforce (via Git Fusion)',
  credentialFields: [
    { key: 'username', label: 'P4 Username', type: 'text', required: true },
    { key: 'token', label: 'P4 Ticket / Password', type: 'password', required: true },
    { key: 'port', label: 'P4PORT (e.g. ssl:perforce:1666)', type: 'text', required: true }
  ],

  async testConnection(credentials) {
    try {
      const env = {
        ...process.env,
        P4PORT: credentials.port,
        P4USER: credentials.username,
        P4PASSWD: credentials.token
      };
      execSync('p4 info', { encoding: 'utf8', timeout: 10_000, env });
      return { success: true, user: credentials.username };
    } catch (err) {
      return { success: false, error: err.message?.split('\n')[0] || 'p4 command failed' };
    }
  },

  async listRepos(credentials) {
    // Git Fusion repos are mapped depots — listing requires admin access
    // or reading the repo config. Return empty with guidance.
    return {
      repos: [],
      hasMore: false,
      error: 'Perforce repos must be specified manually via Git Fusion URL. Use getCloneUrl with the depot path.'
    };
  },

  getCloneUrl(credentials, { repo, baseUrl } = {}) {
    // Git Fusion bridge URL format: https://user:ticket@gitfusion-host/repo
    if (!baseUrl) return null;
    const url = new URL(baseUrl);
    url.username = credentials.username;
    url.password = credentials.token;
    url.pathname = `/${repo}`;
    return url.toString();
  },

  async postPRComment() {
    return { success: false, error: 'Perforce does not support pull request comments' };
  },

  async setCommitStatus() {
    return { success: false, error: 'Perforce does not support commit status checks' };
  }
};
