/**
 * Gitea Platform Integration
 *
 * Supports self-hosted Gitea instances.
 * Uses Personal Access Tokens for authentication.
 * API: Gitea REST (Swagger)
 */

function getApiUrl(baseUrl) {
  return `${(baseUrl || '').replace(/\/$/, '')}/api/v1`;
}

export default {
  id: 'gitea',
  name: 'Gitea',
  credentialFields: [
    { key: 'token', label: 'Personal Access Token', type: 'password', required: true }
  ],

  async testConnection(credentials, { baseUrl } = {}) {
    if (!baseUrl) return { success: false, error: 'Base URL is required for Gitea' };
    const apiUrl = getApiUrl(baseUrl);
    try {
      const res = await fetch(`${apiUrl}/user`, {
        headers: { Authorization: `token ${credentials.token}` }
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      const user = await res.json();
      return { success: true, user: user.login };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async listRepos(credentials, { baseUrl, page = 1, perPage = 25, search } = {}) {
    if (!baseUrl) return { repos: [], hasMore: false, error: 'Base URL required' };
    const apiUrl = getApiUrl(baseUrl);
    try {
      let url = `${apiUrl}/user/repos?limit=${perPage}&page=${page}&sort=updated`;
      if (search) {
        url = `${apiUrl}/repos/search?q=${encodeURIComponent(search)}&limit=${perPage}&page=${page}&sort=updated`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `token ${credentials.token}` }
      });
      if (!res.ok) {
        return { repos: [], hasMore: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      const items = search ? (data.data || []) : data;

      const repos = items.map(r => ({
        fullName: r.full_name,
        defaultBranch: r.default_branch || 'main',
        private: r.private,
        updatedAt: r.updated_at
      }));

      return { repos, hasMore: repos.length === perPage };
    } catch (err) {
      return { repos: [], hasMore: false, error: err.message };
    }
  },

  getCloneUrl(credentials, { owner, repo, baseUrl } = {}) {
    const host = new URL(baseUrl).host;
    return `https://${credentials.token}@${host}/${owner}/${repo}.git`;
  },

  async postPRComment(credentials, { owner, repo, prNumber, body, baseUrl } = {}) {
    if (!baseUrl) return { success: false, error: 'Base URL required' };
    const apiUrl = getApiUrl(baseUrl);
    try {
      const res = await fetch(`${apiUrl}/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `token ${credentials.token}`,
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
    if (!baseUrl) return { success: false, error: 'Base URL required' };
    const apiUrl = getApiUrl(baseUrl);
    // Gitea states: pending, success, error, failure, warning
    try {
      const res = await fetch(`${apiUrl}/repos/${owner}/${repo}/statuses/${sha}`, {
        method: 'POST',
        headers: {
          Authorization: `token ${credentials.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          state: state === 'warning' ? 'warning' : state,
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
