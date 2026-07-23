---
name: DO deploy pitfalls
description: Hard-won lessons from deploying this Next.js app from Replit to a DigitalOcean droplet via SSH.
---

## Rules

**Why:** Each of these caused real outages or silent failures during the first successful deploy session.

### 1. Never `git clean` on the production server
`git clean -fd` deletes `node_modules`, `.next`, and `.env.local` (all gitignored/untracked).
`git reset --hard origin/main` alone is sufficient — it resets tracked files and does not touch untracked ones.
**How to apply:** The deploy script uses only `git reset --hard`; no `git clean`.

### 2. package-lock.json contains Replit-internal proxy URLs
Replit's npm sandbox injects `package-firewall.replit.local` into every tarball `resolved` URL in `package-lock.json`.
`npm ci --registry` does NOT override these baked-in URLs.
**Fix:** `sed -i 's|http://package-firewall.replit.local/npm|https://registry.npmjs.org|g' package-lock.json` before `npm ci`, then `git checkout -- package-lock.json` to restore the original (sha hashes are unaffected by URL host change).
**How to apply:** Already in `scripts/deploy-to-do.sh` build section.

### 3. DATABASE_URL in Replit resolves to `helium` — only works inside Replit
Replit's Neon integration injects a DATABASE_URL with hostname `helium` (internal proxy).
The DO server cannot resolve `helium`. The server needs the actual external Neon connection string.
**Fix:** Get the real `postgresql://...@ep-xxx.neon.tech/...` URL from console.neon.tech and put it in `/var/www/citefi/.env.local` on the server.
**How to apply:** When pushing `.env.local` from Replit to the server, the DATABASE_URL must be replaced with the external Neon URL manually or via a separate secret (e.g. `DO_DATABASE_URL`).

### 4. `.env.local` is never in git — push it via SSH stdin pipe
The 9-line `.env.local` in the Replit workspace only contains non-secret config vars.
Actual secrets (GEMINI_API_KEY, OPENAI_API_KEY, etc.) are Replit-injected env vars, readable in bash but not in the file.
**Fix:** Build a combined env file in a Python snippet reading both the file and `os.environ`, then push via `ssh ... 'cat > /path/.env.local' < /tmp/combined_env`.
**How to apply:** This is a manual recovery step; automate cautiously (never log values).

### 5. PM2 `startOrReload` ✓ does NOT mean the process is stable
PM2 returns ✓ immediately after launching the process, before it has bound to a port or even started Node.
A crash-looping process shows `online` at `0s` uptime with an incrementing restart counter.
**Detection:** Compare restart counter before/after via `pm2 jlist`, wait 3s, check again. Also check `ss -ltnp sport = :5000`.
**How to apply:** Already in the deploy script's crash-loop detection section.

### 6. Build must run whenever `.next` or `node_modules` is missing
SHA-match skip logic (`OLD_SHA == NEW_SHA → skip build`) is unsafe after any server wipe.
Always check `[[ -d .next ]] && [[ -d node_modules ]]` and force build if either is absent.
**How to apply:** Already in the deploy script's NEEDS_BUILD logic.

### 7. SSH key from Replit secret has spaces instead of newlines
Replit stores multi-line secrets with literal spaces. The PEM must be reconstructed before writing to disk.
**Fix:** Python regex to split on `-----BEGIN/END` boundaries and then split body on spaces.
**How to apply:** Already in `scripts/deploy-to-do.sh` key setup section.
