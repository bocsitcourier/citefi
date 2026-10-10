---
name: DO deploy pitfalls
description: Hard-won lessons from deploying this Next.js app from Replit to a DigitalOcean droplet via SSH.
---

Historical in-place build and recovery notes below do not authorize those steps
for the current immutable release path. Consult the production runbook before
using an older recipe; in particular, never stop all PM2 processes or install
dependencies in the active release as part of a normal release.

## Rules

### Next development-server environment flags
Do not start Next development servers with Node `--env-file` arguments. Supply
their environment through PM2's structured `env` and the release's `.env.local`.

**Why:** Next forwards Node execution arguments to its child server through
`NODE_OPTIONS`, where Node rejects `--env-file`; the parent can appear started
while its web child repeatedly exits.

**How to apply:** Reserve Node `--env-file` for ordinary Node processes that do
not forward execution arguments into `NODE_OPTIONS`. Check the actual HTTP
endpoint, not only a successful PM2 start.

### Production target for live QA
Use the DigitalOcean production server, not the separate Replit deployment, for
the requested production update and subsequent live acceptance testing.
**Why:** The user explicitly identified DigitalOcean when asked to distinguish
the two available production paths.
**How to apply:** Prepare the reviewed GitHub/DigitalOcean release and verify
that target. Do not treat a successful Replit publish or preview as evidence
that the DigitalOcean server received the changes.

**Why:** Each of these caused real outages or silent failures during the first successful deploy session.

### 1. Never run broad Git cleanup against the active production tree
Broad cleanup can remove unmanaged runtime files or shared configuration;
whether ignored files are included depends on the cleanup flags.
**Why:** Historical cleanup removed runtime dependencies and shared configuration.
**How to apply:** Use immutable releases. Neither cleaning nor resetting the
active tree is a normal deployment step.

### 2. package-lock.json contains Replit-internal proxy URLs
Replit's npm sandbox can inject both `package-firewall.replit.local` and
`package-firewall.replit.internal` into tarball `resolved` URLs in lockfiles.
`npm ci --registry` does NOT override these baked-in URLs.
Inspect the frozen exported artifact, including nested lockfiles, rather than
trusting an earlier workspace observation. Normalize both private proxy hosts
in the isolated exported copy; preserve locked versions and integrity hashes.
Do not rely on `--registry` to rewrite tarball URLs.

**Why:** A DigitalOcean install reported npm's misleading “Exit handler never
called!” error; its debug log showed `ENOTFOUND` for a private proxy host. An
earlier assumption that the exported lock contained only public hosts was wrong.

**How to apply:** Keep the Replit workspace lock compatible with its package
firewall, and use a tested source-export transformation for staging deployments.

### 3. Preview settings do not establish the production database target
**Why:** The droplet historically moved to its own PostgreSQL while the preview
continued using Neon. This history is not a live inventory.
**How to apply:** Verify the actual production target before database work;
never replace host database settings with preview settings during release.

### 4. Preserve shared production configuration
**Why:** The workspace environment file was not a complete copy of production
configuration; copying it over the host can remove credentials or change targets.
**How to apply:** Preserve the host's shared environment during normal releases.
Approved secret recovery is separate; do not export workspace secrets or
replace production configuration as a deployment shortcut.

### 5. PM2 `startOrReload` ✓ does NOT mean the process is stable
PM2 returns ✓ immediately after launching the process, before it has bound to a port or even started Node.
A crash-looping process shows `online` at `0s` uptime with an incrementing restart counter.
**Detection:** Compare restart counter before/after via `pm2 jlist`, wait 3s, check again. Also check `ss -ltnp sport = :5000`.
**How to apply:** Verify HTTP readiness and stable process behavior after cutover.

### 6. A matching source SHA does not prove artifact completeness
**Why:** Interrupted builds or server wipes left matching checkouts with missing
runtime files. Directory existence did not prove a usable build.
**How to apply:** Validate artifact completeness and build identity off-host.
Missing files require a new artifact, not repairs to the active tree.

### 7. Credential formatting is separate from availability
**Why:** A historically supplied key required newline reconstruction; this did
not mean the infrastructure account was unavailable.
**How to apply:** Use the established secure runner's key handling. Never print
keys, request replacements solely because local variables are absent, or
weaken host pinning.

### 9. In-place installs can silently leave partial dependencies
**Why:** Memory pressure on the small droplet interrupted dependency installation
despite an apparently successful exit status, causing startup failures.
**How to apply:** Install and build off-host, then activate the validated artifact.
Do not stop all PM2 services or install in the active directory.

### 10. Root maintenance of a citefi-owned repo requires `safe.directory`
Direct root recovery against `/var/www/citefi` or `/var/www/citefi-staging` makes Git reject the repo as "dubious ownership" until that exact directory is registered as safe.
**How to apply:** Normal releases run as `citefi`; add `safe.directory` only for an authorized root maintenance session.

### 11. One service account must own both release files and PM2 — CRITICAL
Mixing root-owned `.next`/`node_modules` with the `citefi` PM2 daemon caused `npm ci` and `next build` permission failures, deleted `BUILD_ID`, and left web in a crash loop. PM2's momentary `online` state hid the outage.
**Why:** A root deployment followed by a `citefi` deployment split ownership across the same release tree.
**How to apply:** Normal SSH releases must run as `citefi`. Root is recovery-only. Fail before stopping processes if the app tree has mixed ownership or the deploy user differs from the directory owner.

### 12. Build resource limits are not live-server repair instructions
**Why:** Historical on-host compilation and prerendering exhausted the small
droplet's memory. Swap and forced dynamic rendering were old recovery measures,
not universal rendering requirements.
**How to apply:** Budget resources on the off-host builder. Do not add swap,
change rendering policy, or stop unrelated processes during normal releases.

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

Locate the staging topology through deployment configuration and authenticated
server inspection before asking the user to identify staging or repeat credentials.
If public endpoints were never provisioned, explain that missing setup and ask
for the necessary operational authorization, not an existing URL.

**Why:** The user expects us to trace the environment we configured. A private
staging directory is not evidence that a public staging app or receiver exists.

**How to apply:** Reuse the established GitHub-held SSH access, distinguish file
configuration from active services and public routing, and keep shared-proxy/DNS
changes separate from authorization for synthetic delivery tests.

Missing SSH variables in the local Replit process do not establish that the
existing DigitalOcean access path is unavailable.

**Why:** The deployment workflow supplies its SSH credentials from GitHub-held
secrets, independently of the local workspace environment. Treating local
absence as global absence led to an incorrect deployment-capability claim.

**How to apply:** Inspect the documented workflow mapping and authenticated
operational evidence before requesting replacement credentials or claiming
there is no access. A saved mapping is not proof of a successful current login.

For explicitly authorized isolated staging infrastructure setup, test whether
the existing GitHub-held key also authenticates root before requesting new
credentials. A service account's missing sudo access does not prove that the
saved infrastructure access is unusable.

**Why:** The existing key authenticated both the service account and root,
while the service account could not configure nginx.

**How to apply:** Keep ordinary releases under the service account. Limit root
to a fixed staging infrastructure controller; extract, install and run
application code as the service account. Never infer permission to deploy or
rotate production credentials from successful root authentication.

### 16. In-place droplet deploys must never run automatically on push
The historical in-place process stopped PM2 before installing and building.
Running it on every push caused Nginx 502s for the installation/build window.
**Why:** Validation success does not make an in-place build zero-downtime; Nginx has no upstream while PM2 is stopped.
**How to apply:** Keep activation explicitly approved. Source synchronization
is not production cutover permission; do not restore automatic in-place releases.

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
