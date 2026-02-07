/**
 * Bitbucket Platform Integration
 *
 * Supports Bitbucket Cloud (bitbucket.org).
 * Uses Username + App Password for authentication.
 * API: Bitbucket REST 2.0
 */

const DEFAULT_BASE_URL = 'https://bitbucket.org';
const API_URL = 'https://api.bitbucket.org/2.0';

function getApiUrl(baseUrl) {
  if (!baseUrl || baseUrl === DEFAULT_BASE_URL) return API_URL;
  return `${baseUrl.replace(/\/$/, '')}/rest/api/2.0`;
}

function authHeader(credentials) {
  const encoded = Buffer.from(`${credentials.username}:${credentials.token}`).toString('base64');
  return `Basic ${encoded}`;
}

export default {
  id: 'bitbucket',
  name: 'Bitbucket',
  credentialFields: [
    { key: 'username', label: 'Username', type: 'text', required: true },
    { key: 'token', label: 'App Password', type: 'password', required: true }
  ],

  async testConnection(credentials, { baseUrl } = {}) {
    const apiUrl = getApiUrl(baseUrl);
    try {
      const res = await fetch(`${apiUrl}/user`, {
        headers: { Authorization: authHeader(credentials) }
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      const user = await res.json();
      return { success: true, user: user.username || user.display_name };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async listRepos(credentials, { baseUrl, page = 1, perPage = 25, search } = {}) {
    const apiUrl = getApiUrl(baseUrl);
    try {
      let url = `${apiUrl}/repositories/${credentials.username}?pagelen=${perPage}&page=${page}&sort=-updated_on`;
      if (search) url += `&q=name~"${encodeURIComponent(search)}"`;

      const res = await fetch(url, {
        headers: { Authorization: authHeader(credentials) }
      });
      if (!res.ok) {
        return { repos: [], hasMore: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      const repos = (data.values || []).map(r => ({
        fullName: r.full_name,
        defaultBranch: r.mainbranch?.name || 'main',
        private: r.is_private,
        updatedAt: r.updated_on
      }));

      return { repos, hasMore: !!data.next };
    } catch (err) {
      return { repos: [], hasMore: false, error: err.message };
    }
  },

  getCloneUrl(credentials, { owner, repo, baseUrl } = {}) {
    const host = baseUrl ? new URL(baseUrl).host : 'bitbucket.org';
    return `https://${credentials.username}:${credentials.token}@${host}/${owner}/${repo}.git`;
  },

  async postPRComment(credentials, { owner, repo, prNumber, body, baseUrl } = {}) {
    const apiUrl = getApiUrl(baseUrl);
    try {
      const res = await fetch(`${apiUrl}/repositories/${owner}/${repo}/pullrequests/${prNumber}/comments`, {
        method: 'POST',
        headers: {
          Authorization: authHeader(credentials),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: { raw: body } })
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      const comment = await res.json();
      return { success: true, commentId: comment.id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async setCommitStatus(credentials, { owner, repo, sha, state, description, targetUrl, baseUrl } = {}) {
    const apiUrl = getApiUrl(baseUrl);
    // Bitbucket states: SUCCESSFUL, FAILED, INPROGRESS, STOPPED
    const bbStateMap = { success: 'SUCCESSFUL', failure: 'FAILED', pending: 'INPROGRESS', error: 'FAILED', warning: 'INPROGRESS' };
    const bbState = bbStateMap[state] || 'INPROGRESS';
    try {
      const res = await fetch(`${apiUrl}/repositories/${owner}/${repo}/commit/${sha}/statuses/build`, {
        method: 'POST',
        headers: {
          Authorization: authHeader(credentials),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          state: bbState,
          key: 'swynx-scan',
          name: 'Swynx Scan',
          description: description || 'Swynx scan',
          url: targetUrl || 'https://swynx.oynk.co.uk'
        })
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};
