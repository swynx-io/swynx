/**
 * Forgejo Platform Integration
 *
 * Forgejo is a Gitea fork with compatible API.
 * Re-exports gitea module with different id/name.
 */

import gitea from './gitea.mjs';

export default {
  ...gitea,
  id: 'forgejo',
  name: 'Forgejo'
};
