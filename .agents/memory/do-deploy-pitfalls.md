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

### 3. Production DB is local PostgreSQL 16 on the droplet — not Neon
The live server runs its own PostgreSQL 16 instance at `localhost:5432`, database `citefi`, user `citefi`.
`lib/db.ts` auto-detects: URL without `neon.tech` / `@helium` → uses standard `pg` pool (not Neon HTTP driver).
`pg_hba.conf` has a `scram-sha-256` entry for `citefi` user (local socket).
**Neon was the original DB.** Migration: installed `postgresql-client-18` (pgdg apt repo), `pg_dump --no-owner --no-acl` from Neon, restored via `sudo -u postgres psql`, reassigned ownership, updated `.env.local`.
**How to apply:** `DATABASE_URL=postgresql://citefi:<pass>@localhost:5432/citefi` — no `DATABASE_POOLED_URL` needed.

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

### 9. Stop PM2 BEFORE `npm ci`, not just before `next build` — CRITICAL
PM2 holds ~200 MB of RAM while running. `npm ci` on a 2 GB droplet OOMs without that headroom, causing a **partial** `node_modules` write. The install reports success (exit 0) but some packages (e.g. `styled-jsx`) are silently absent, causing `Cannot find module 'styled-jsx/package.json'` crashes at startup.
**Fix:** `pm2 stop all` must run immediately before `npm ci`, not before `npm run build`.
**Symptoms:** Build succeeds (compilation + static generation all pass), but PM2 starts the app and it crashes immediately. PM2 shows `online` then `errored` within seconds. PM2 logs show `Cannot find module 'styled-jsx/package.json'` from `node_modules/next/dist/server/require-hook.js`.
**How to apply:** Both `.github/workflows/deploy.yml` and `scripts/deploy-to-do.sh` now stop PM2 before `npm ci`.

### 10. Root maintenance of a citefi-owned repo requires `safe.directory`
Direct root recovery against `/var/www/citefi` or `/var/www/citefi-staging` makes Git reject the repo as "dubious ownership" until that exact directory is registered as safe.
**How to apply:** Normal releases run as `citefi`; add `safe.directory` only for an authorized root maintenance session.

### 11. One service account must own both release files and PM2 — CRITICAL
Mixing root-owned `.next`/`node_modules` with the `citefi` PM2 daemon caused `npm ci` and `next build` permission failures, deleted `BUILD_ID`, and left web in a crash loop. PM2's momentary `online` state hid the outage.
**Why:** A root deployment followed by a `citefi` deployment split ownership across the same release tree.
**How to apply:** Normal SSH releases must run as `citefi`. Root is recovery-only. Fail before stopping processes if the app tree has mixed ownership or the deploy user differs from the directory owner.

### 12. `next build` peaks at ~1.7 GB RSS on 2 GB droplet — add 2 GB swap before building
Even with `export const dynamic = "force-dynamic"` in `app/layout.tsx` (which prevents static-page OOM), the build's compilation/bundling phase peaks at ~1.7 GB RSS. On a 2 GB droplet with OS overhead, the OOM killer kills the build mid-way, leaving `.next` without `BUILD_ID`.
**Fix:** Deploy script creates `/swapfile2` (2 GB, fallocate) and activates it with `swapon` before `npm ci`. The 2 GB existing `/swapfile` can be 80%+ used from previous heavy loads; the second file is the safety net.
**Symptoms:** Build "completes" (exit 0 from the Actions script perspective) but `.next/BUILD_ID` is missing; `required-server-files.json` absent; PM2 crash-loops with "Could not find a production build" or `ENOENT required-server-files.json`.
**How to apply:** `/swapfile2` creation is idempotent (skips if exists + already swapped); in both `.github/workflows/deploy.yml` and `scripts/deploy-to-do.sh`.

### 8. `next build` OOMs on 2 GB droplet during "Collecting page data" phase — CRITICAL
The "Collecting page data" phase of `next build` runs the full Next.js app in a jest-worker process to statically pre-render pages. On a 2 GB droplet this always OOMs (EXIT=137, SIGKILL) if ANY static pages exist. The compilation phase alone (~1.4 GB RAM) succeeds fine.
**Symptoms:** Build log shows `✓ Compiled successfully in 6.6min` followed by `Collecting page data using 1 worker ...` and then exits with code 137. `.next/BUILD_ID` is never written. PM2 crash-loops with "Could not find a production build".
**Fix:** Add `export const dynamic = "force-dynamic"` to `app/layout.tsx` (root layout). This propagates to all child routes and skips static page pre-rendering entirely — the "Collecting page data" phase simply has nothing to collect and completes instantly.
**Secondary fix:** Stop PM2 before building (`pm2 stop all`) to reclaim the ~200MB of RAM PM2+app holds. Two builds running simultaneously will definitely OOM.
**Deploy script check:** The NEEDS_BUILD logic must test `[[ ! -f .next/BUILD_ID ]]` (not just `[[ ! -d .next ]]`). An OOM-killed build leaves a partial `.next` directory that looks present but has no BUILD_ID.
**How to apply:** `export const dynamic = "force-dynamic"` is in `app/layout.tsx`; `pm2 stop all` before build and `BUILD_ID` check are in `scripts/deploy-to-do.sh`.

### 13. Redis is a host dependency, not an npm dependency
Production and shared-host staging both expect Redis at `127.0.0.1:6379`. If Redis is absent, the website may render while worker, queue, heartbeat, and provider-circuit health all fail.
**Why:** The droplet initially had no Redis package even though both runtime env files pointed to localhost.
**How to apply:** Keep `redis-server` enabled under systemd. Production uses Redis DB 0; staging uses DB 1. Never share the same Redis DB between environments.

### 14. Host schema commands must explicitly load `.env.local`
`npm run db:push` does not automatically load `.env.local` on the droplet, so Drizzle reports a missing database URL even though the application can load it.
**Why:** Replit injects database variables into the shell, but a plain SSH shell does not.
**How to apply:** Invoke Drizzle through Node with `--env-file=.env.local`; invoke every TypeScript migration with the same explicit env file.

### 15. Shared-host staging is isolated by resource, not by hostname
The safe staging topology is a separate app directory and PM2 names, port 5100, database `citefi_staging`, Redis DB 1, and `staging/synthetic/` object prefix. It contains no copied production rows.
**Why:** Destructive drills need production parity without risking the live application or customer data.
**How to apply:** Keep staging loopback-only until its DNS and HTTPS proxy are configured. Never substitute the production database, Redis DB 0, production process names, or unprefixed storage.

### 16. In-place droplet deploys must never run automatically on push
The current host release process stops PM2 before installing and building in the live directory. Triggering it on every main-branch push caused an immediate Nginx 502 for the full install/build window.
**Why:** Validation success does not make an in-place build zero-downtime; Nginx has no upstream while PM2 is stopped.
**How to apply:** Keep the DigitalOcean workflow manual-only until releases build in a separate directory and switch atomically. Ordinary GitHub pushes must never invoke the in-place release runner.

### 17. Build and validate immutable release artifacts off-host
The droplet must receive a checksum/size-bound artifact that already contains its production build and runtime dependencies; it must never install packages or build in the active tree.
**Why:** Interrupted on-host builds deleted the live `BUILD_ID` and created multi-thousand-restart PM2 crash loops.
**How to apply:** Build from a clean Git commit away from the host, reject unsafe archive paths/links, unpack once into a checksum-named release, then atomically switch `current`.

### 18. Historical migrations must support pre-ledger adoption
An existing database can contain migration-created objects while the checksum ledger is empty; replaying such a migration must be safe or explicitly catalog-baselined.
**Why:** Staging already had immutable-ledger triggers and policies from the former migration path, so first ledger adoption collided with their names.
**How to apply:** Make adoption-era migrations idempotent for known objects, execute each migration transactionally, and require catalog verification before cutover.

### 19. PM2 reload does not migrate an executable type
`startOrReload` can preserve a legacy executable and pass new wrapper arguments to the wrong program.
**Why:** The first staging cutover passed `--web` to the legacy Next.js executable instead of changing it to the bounded bootstrap wrapper.
**How to apply:** Compare live `pm_exec_path` with the desired config. When the executable type differs, delete/start only that named process; use normal reload only after both sides use the same wrapper. Apply the inverse on rollback.

### 20. Shared operational status cannot live inside release directories
Backup and deployment status must remain at stable shared paths across symlink switches.
**Why:** Readiness falsely failed when a new release looked for status files that belonged to a prior directory layout.
**How to apply:** Configure explicit shared status paths for every environment and preserve them independently of immutable release cleanup.

### 21. Provider canaries require an explicit non-customer owner
Real provider-backed canaries must use an explicit accounting team and must fail closed when the provider account cannot execute.
**Why:** Picking an arbitrary customer would corrupt immutable COGS attribution; a depleted provider account otherwise looks like release readiness.
**How to apply:** Give staging a synthetic-only accounting team, production an approved system owner, and never seed a fake success to bypass a provider-capacity failure.
