/**
 * GitLab Platform Integration
 *
 * Supports gitlab.com and self-hosted GitLab.
 * Uses Personal Access Tokens for authentication.
 * API: GitLab REST v4
 */

const DEFAULT_BASE_URL = 'https://gitlab.com';

function getApiUrl(baseUrl) {
  return `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')}/api/v4`;
}

export default {
  id: 'gitlab',
  name: 'GitLab',
  credentialFields: [
    { key: 'token', label: 'Personal Access Token', type: 'password', required: true }
  ],

  async testConnection(credentials, { baseUrl } = {}) {
    const apiUrl = getApiUrl(baseUrl);
    try {
      const res = await fetch(`${apiUrl}/user`, {
        headers: { 'PRIVATE-TOKEN': credentials.token }
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      const user = await res.json();
      return { success: true, user: user.username };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async listRepos(credentials, { baseUrl, page = 1, perPage = 25, search } = {}) {
    const apiUrl = getApiUrl(baseUrl);
    try {
      let url = `${apiUrl}/projects?membership=true&per_page=${perPage}&page=${page}&order_by=updated_at&sort=desc`;
      if (search) url += `&search=${encodeURIComponent(search)}`;

      const res = await fetch(url, {
        headers: { 'PRIVATE-TOKEN': credentials.token }
      });
      if (!res.ok) {
        return { repos: [], hasMore: false, error: `HTTP ${res.status}` };
      }
      const projects = await res.json();
      const repos = projects.map(p => ({
        fullName: p.path_with_namespace,
        defaultBranch: p.default_branch || 'main',
        private: p.visibility === 'private',
        updatedAt: p.last_activity_at
      }));

      const totalPages = parseInt(res.headers.get('x-total-pages') || '1', 10);
      return { repos, hasMore: page < totalPages };
    } catch (err) {
      return { repos: [], hasMore: false, error: err.message };
    }
  },

  getCloneUrl(credentials, { owner, repo, baseUrl } = {}) {
    const host = baseUrl ? new URL(baseUrl).host : 'gitlab.com';
    return `https://oauth2:${credentials.token}@${host}/${owner}/${repo}.git`;
  },

  async postPRComment(credentials, { owner, repo, prNumber, body, baseUrl } = {}) {
    const apiUrl = getApiUrl(baseUrl);
    const projectPath = encodeURIComponent(`${owner}/${repo}`);
    try {
      const res = await fetch(`${apiUrl}/projects/${projectPath}/merge_requests/${prNumber}/notes`, {
        method: 'POST',
        headers: {
          'PRIVATE-TOKEN': credentials.token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body })
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      const note = await res.json();
      return { success: true, commentId: note.id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async setCommitStatus(credentials, { owner, repo, sha, state, description, targetUrl, baseUrl } = {}) {
    const apiUrl = getApiUrl(baseUrl);
    const projectPath = encodeURIComponent(`${owner}/${repo}`);
    // GitLab states: pending, running, success, failed, canceled
    const glStateMap = { success: 'success', failure: 'failed', pending: 'pending', error: 'failed', warning: 'pending' };
    const glState = glStateMap[state] || 'pending';
    try {
      const res = await fetch(`${apiUrl}/projects/${projectPath}/statuses/${sha}`, {
        method: 'POST',
        headers: {
          'PRIVATE-TOKEN': credentials.token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          state: glState,
          description: description || 'Swynx scan',
          target_url: targetUrl || '',
          name: 'swynx/scan'
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
