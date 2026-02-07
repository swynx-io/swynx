/**
 * GitHub Platform Integration
 *
 * Supports github.com and GitHub Enterprise Server.
 * Uses Personal Access Tokens (PATs) for authentication.
 * API: GitHub REST v3
 */

const DEFAULT_BASE_URL = 'https://github.com';
const DEFAULT_API_URL = 'https://api.github.com';

function getApiUrl(baseUrl) {
  if (!baseUrl || baseUrl === DEFAULT_BASE_URL) return DEFAULT_API_URL;
  // GitHub Enterprise: https://ghe.example.com/api/v3
  return `${baseUrl.replace(/\/$/, '')}/api/v3`;
}

export default {
  id: 'github',
  name: 'GitHub',
  credentialFields: [
    { key: 'token', label: 'Personal Access Token', type: 'password', required: true }
  ],

  async testConnection(credentials, { baseUrl } = {}) {
    const apiUrl = getApiUrl(baseUrl);
    try {
      const res = await fetch(`${apiUrl}/user`, {
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          Accept: 'application/vnd.github+json'
        }
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      const user = await res.json();
      const scopeHeader = res.headers.get('x-oauth-scopes');
      return {
        success: true,
        user: user.login,
        scopes: scopeHeader ? scopeHeader.split(',').map(s => s.trim()) : []
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async listRepos(credentials, { baseUrl, page = 1, perPage = 25, search } = {}) {
    const apiUrl = getApiUrl(baseUrl);
    const headers = {
      Authorization: `Bearer ${credentials.token}`,
      Accept: 'application/vnd.github+json'
    };

    try {
      let url;
      if (search) {
        const q = encodeURIComponent(`${search} in:name fork:true`);
        url = `${apiUrl}/search/repositories?q=${q}&per_page=${perPage}&page=${page}&sort=updated`;
      } else {
        url = `${apiUrl}/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`;
      }

      const res = await fetch(url, { headers });
      if (!res.ok) {
        return { repos: [], hasMore: false, error: `HTTP ${res.status}` };
      }

      const data = await res.json();
      const items = search ? data.items : data;

      const repos = (items || []).map(r => ({
        fullName: r.full_name,
        defaultBranch: r.default_branch || 'main',
        private: r.private,
        updatedAt: r.updated_at
      }));

      const linkHeader = res.headers.get('link');
      const hasMore = linkHeader ? linkHeader.includes('rel="next"') : repos.length === perPage;

      return { repos, hasMore };
    } catch (err) {
      return { repos: [], hasMore: false, error: err.message };
    }
  },

  getCloneUrl(credentials, { owner, repo, baseUrl } = {}) {
    const host = baseUrl ? new URL(baseUrl).host : 'github.com';
    return `https://${credentials.token}@${host}/${owner}/${repo}.git`;
  },

  async postPRComment(credentials, { owner, repo, prNumber, body, baseUrl } = {}) {
    const apiUrl = getApiUrl(baseUrl);
    try {
      const res = await fetch(`${apiUrl}/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body })
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
    // GitHub states: error, failure, pending, success
    const ghState = state === 'warning' ? 'pending' : state;
    try {
      const res = await fetch(`${apiUrl}/repos/${owner}/${repo}/statuses/${sha}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          state: ghState,
          description: description || 'Swynx scan',
          target_url: targetUrl || '',
          context: 'swynx/scan'
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
