/**
 * AWS CodeCommit Platform Integration
 *
 * Uses IAM credentials (profile-based) for authentication.
 * Clone via codecommit:: protocol (requires aws cli + git-remote-codecommit).
 * No status check API — only PR comments supported.
 */

import { execSync } from 'child_process';

export default {
  id: 'codecommit',
  name: 'AWS CodeCommit',
  credentialFields: [
    { key: 'profile', label: 'AWS Profile Name', type: 'text', required: true },
    { key: 'region', label: 'AWS Region', type: 'text', required: true }
  ],

  async testConnection(credentials) {
    try {
      const env = { ...process.env, AWS_PROFILE: credentials.profile, AWS_DEFAULT_REGION: credentials.region };
      const output = execSync('aws codecommit list-repositories --max-items 1', {
        encoding: 'utf8', timeout: 15_000, env
      });
      const data = JSON.parse(output);
      return { success: true, user: credentials.profile, scopes: [`region:${credentials.region}`] };
    } catch (err) {
      return { success: false, error: err.message?.split('\n')[0] || 'AWS CLI error' };
    }
  },

  async listRepos(credentials, { page = 1, perPage = 25, search } = {}) {
    try {
      const env = { ...process.env, AWS_PROFILE: credentials.profile, AWS_DEFAULT_REGION: credentials.region };
      const output = execSync('aws codecommit list-repositories', {
        encoding: 'utf8', timeout: 15_000, env
      });
      const data = JSON.parse(output);
      let items = data.repositories || [];

      if (search) {
        const q = search.toLowerCase();
        items = items.filter(r => r.repositoryName.toLowerCase().includes(q));
      }

      const start = (page - 1) * perPage;
      const slice = items.slice(start, start + perPage);

      const repos = slice.map(r => ({
        fullName: r.repositoryName,
        defaultBranch: 'main',
        private: true,
        updatedAt: null
      }));

      return { repos, hasMore: start + perPage < items.length };
    } catch (err) {
      return { repos: [], hasMore: false, error: err.message?.split('\n')[0] || 'AWS CLI error' };
    }
  },

  getCloneUrl(credentials, { repo } = {}) {
    return `codecommit::${credentials.region}://${credentials.profile}@${repo}`;
  },

  async postPRComment(credentials, { repo, prNumber, body } = {}) {
    try {
      const env = { ...process.env, AWS_PROFILE: credentials.profile, AWS_DEFAULT_REGION: credentials.region };
      // Get PR details to find source/dest commits
      const prOutput = execSync(
        `aws codecommit get-pull-request --pull-request-id ${prNumber}`,
        { encoding: 'utf8', timeout: 15_000, env }
      );
      const pr = JSON.parse(prOutput).pullRequest;
      const target = pr.pullRequestTargets?.[0];
      if (!target) {
        return { success: false, error: 'Could not find PR target' };
      }

      const commentInput = JSON.stringify({
        pullRequestId: String(prNumber),
        repositoryName: repo,
        beforeCommitId: target.destinationCommit,
        afterCommitId: target.sourceCommit,
        content: body
      });

      execSync(
        `aws codecommit post-comment-for-pull-request --cli-input-json '${commentInput.replace(/'/g, "'\\''")}'`,
        { encoding: 'utf8', timeout: 15_000, env }
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message?.split('\n')[0] || 'AWS CLI error' };
    }
  },

  async setCommitStatus() {
    // CodeCommit does not support commit status checks
    return { success: false, error: 'CodeCommit does not support commit status checks' };
  }
};
