Do not add Co-Authored-By lines to commits.

## Dashboard Deploy & Push Procedure

The dashboard UI source lives in `/var/www/peer-audit/ui-src/`. Clients install via `curl -fsSL https://swynx.io/install.sh | bash` which does `git clone --depth 1` from the `swynx-io/swynx` GitHub repo. Every change must reach all 3 locations + GitHub.

**Every time you build/deploy the dashboard, follow ALL of these steps:**

1. **Build:** `cd /var/www/peer-audit/ui-src && npx vite build`
2. **Deploy to all 3 locations:**
   - `cp -r /var/www/peer-audit/ui-src/dist/* /var/lib/swynx/public/`
   - `cp -r /var/www/peer-audit/ui-src/dist/* /var/www/swynx/src/dashboard/public/`
   - `cp -r /var/www/peer-audit/ui-src/dist/* /var/lib/peer-audit/public/`
3. **Restart dashboard:** `pkill -f "node.*swynx.*dashboard"; sleep 1; cd /var/www/swynx && nohup node bin/swynx dashboard --port 8999 &`
4. **Commit & push to GitHub:** Stage `src/dashboard/public/` (and any backend changes), commit, and `git push origin main` — this is how clients get updates.

**Never skip step 4.** The GitHub push is what delivers changes to every client installation.
