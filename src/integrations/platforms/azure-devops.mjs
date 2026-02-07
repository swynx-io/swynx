/**
 * Azure DevOps Platform Integration
 *
 * Uses Personal Access Tokens for authentication.
 * API: Azure DevOps REST API
 */

const DEFAULT_BASE_URL = 'https://dev.azure.com';

function getApiUrl(baseUrl, org) {
  return `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')}/${org}`;
}

function authHeader(credentials) {
  const encoded = Buffer.from(`:${credentials.token}`).toString('base64');
  return `Basic ${encoded}`;
}

export default {
  id: 'azure-devops',
  name: 'Azure DevOps',
  credentialFields: [
    { key: 'token', label: 'Personal Access Token', type: 'password', required: true },
    { key: 'org', label: 'Organization', type: 'text', required: true }
  ],

  async testConnection(credentials, { baseUrl } = {}) {
    const apiUrl = getApiUrl(baseUrl, credentials.org);
    try {
      const res = await fetch(`${apiUrl}/_apis/projects?api-version=7.0`, {
        headers: { Authorization: authHeader(credentials) }
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      const data = await res.json();
      return {
        success: true,
        user: credentials.org,
        scopes: [`${data.count} project(s) accessible`]
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async listRepos(credentials, { baseUrl, page = 1, perPage = 25, search } = {}) {
    const apiUrl = getApiUrl(baseUrl, credentials.org);
    try {
      // Azure DevOps doesn't paginate repos the same way — fetch all, then slice
      const res = await fetch(`${apiUrl}/_apis/git/repositories?api-version=7.0`, {
        headers: { Authorization: authHeader(credentials) }
      });
      if (!res.ok) {
        return { repos: [], hasMore: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      let items = data.value || [];

      if (search) {
        const q = search.toLowerCase();
        items = items.filter(r => r.name.toLowerCase().includes(q));
      }

      // Sort by last update (if available)
      // Manual pagination
      const start = (page - 1) * perPage;
      const slice = items.slice(start, start + perPage);

      const repos = slice.map(r => ({
        fullName: `${r.project?.name || ''}/${r.name}`,
        defaultBranch: (r.defaultBranch || 'refs/heads/main').replace('refs/heads/', ''),
        private: true, // Azure DevOps repos are always scoped to org
        updatedAt: null
      }));

      return { repos, hasMore: start + perPage < items.length };
    } catch (err) {
      return { repos: [], hasMore: false, error: err.message };
    }
  },

  getCloneUrl(credentials, { owner, repo, baseUrl } = {}) {
    // owner = project name in Azure DevOps context
    const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    return `https://${credentials.token}@${new URL(base).host}/${credentials.org}/${owner}/_git/${repo}`;
  },

  async postPRComment(credentials, { owner, repo, prNumber, body, baseUrl } = {}) {
    const apiUrl = getApiUrl(baseUrl, credentials.org);
    try {
      const res = await fetch(
        `${apiUrl}/${owner}/_apis/git/repositories/${repo}/pullRequests/${prNumber}/threads?api-version=7.0`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader(credentials),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
            status: 1 // Active
          })
        }
      );
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      const thread = await res.json();
      return { success: true, commentId: thread.id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async setCommitStatus(credentials, { owner, repo, sha, state, description, targetUrl, baseUrl } = {}) {
    const apiUrl = getApiUrl(baseUrl, credentials.org);
    // Azure states: notSet, pending, succeeded, failed, error
    const azStateMap = { success: 'succeeded', failure: 'failed', pending: 'pending', error: 'error', warning: 'pending' };
    const azState = azStateMap[state] || 'pending';
    try {
      const res = await fetch(
        `${apiUrl}/${owner}/_apis/git/repositories/${repo}/commits/${sha}/statuses?api-version=7.0`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader(credentials),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            state: azState,
            description: description || 'Swynx scan',
            targetUrl: targetUrl || '',
            context: { name: 'swynx/scan', genre: 'continuous-integration' }
          })
        }
      );
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};
