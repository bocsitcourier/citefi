# Production Readiness and Recovery Drill Runbook

## Certification rule

The executable drill runner records redacted, timestamped JSON under
`reports/production-readiness/`. A normal run is a release certification and
**fails** when any local drill fails or any credential-dependent staging drill
is blocked. `--local-only` is only a developer signal: it permits external
drills to remain `BLOCKED`, and must never be presented as production
certification.

```bash
# Certification attempt (external BLOCKED items make this exit non-zero)
node --env-file=.env.local --import tsx/esm scripts/run-production-readiness-drills.ts

# Explicit local development evidence
node --env-file=.env.local --import tsx/esm scripts/run-production-readiness-drills.ts --local-only

# Evidence contract/failure-semantics tests
node --import tsx/esm --test tests/production-readiness-drills.test.ts
```

Never paste secrets into evidence. Review generated JSON before attaching it to
a change ticket. The runner redacts known credential forms, limits child output,
and stores evidence with owner-only permissions, but operator review remains
mandatory.

## Roles, ownership, and escalation

Roles are assigned by the release change ticket; do not substitute personal
names in this durable runbook.

| Role | Accountable for | Escalation |
|---|---|---|
| Release commander | go/no-go, timeline, rollback decision | Engineering lead, then business incident executive |
| Application on-call | web health, canary, provider circuit, release rollback | Release commander |
| Worker/queue on-call | Redis backlog, worker drain, replay safety | Application on-call, then engineering lead |
| Database owner | DB interruption, migration and restore approval | Release commander; security owner for suspected loss |
| Security owner | credential exposure and evidence handling | Incident executive and legal/privacy owner |
| Customer communications lead | status page and customer updates | Release commander |

Open the incident channel before a staging or production-impacting exercise.
The first observer becomes incident commander until the named release commander
acknowledges. Page the relevant owner immediately; escalate unacknowledged P1
pages after 5 minutes and P2 pages after 15 minutes. Security or suspected data
loss is always P1.

### Independent uptime monitor

`.github/workflows/uptime-monitor.yml` runs every five minutes on GitHub-hosted
infrastructure, independently of the application droplet. It makes three bounded
requests to `https://citefi.co/api/health` before declaring an outage. A sustained
failure opens or updates a durable `uptime-monitor` GitHub issue; recovery adds a
final comment and closes the issue.

- **Primary alert owner:** repository owner, acting as application on-call and
  release commander.
- **Secondary alert owner:** Citefi database/security owner. Escalate to this
  role if the primary has not acknowledged within five minutes.

Repository owners must keep GitHub Actions notifications enabled. Monitor issues
must contain only bounded operational metadata—never credentials, raw logs,
customer data, or signed URLs.

## Recovery targets and rollback criteria

| Capability | RTO target | RPO / invariant |
|---|---:|---|
| Health detects DB loss and recovery | 10 seconds locally; 5 minutes externally | No writes in the health probe |
| Queue backlog drain | 30 seconds for the five-job local drill | 0 queued jobs lost |
| Graceful worker shutdown | 30 seconds | Active work drains or remains recoverable in Redis |
| Provider outage circuit | 2 minutes | Work pauses; it is not discarded |
| Web release rollback | 15 minutes | Return to named known-good SHA |
| Migration rollback | 30 minutes | No rows outside approved migration scope |
| Backup restoration | 60 minutes | Latest successful nightly snapshot, target <=24 hours |

Rollback immediately when database health remains false for 5 minutes, the web
process crash-loops, queue depth grows for 10 minutes with no completions, the
canary fails on both attempts, a migration violates its row-count/integrity
baseline, tenant isolation regresses, or error rate exceeds 5% for 5 minutes.
Do not roll a schema backward while old/new application compatibility is
unknown: stop writes and obtain database-owner approval first.

## Drill inventory and safe execution

The runner uses a dedicated local Redis DB for its controlled five-job backlog,
injects (rather than causing) a database dependency failure, exercises the real
worker drain helper, and invokes the existing provider circuit, restart safety,
crash-boundary, canary, and billing state-machine tests. It verifies release
health-gate and forward/rollback source pairs but does **not** deploy or execute
a migration.

Prerequisites for local execution: Node dependencies, `.env.local`, local Redis
on `127.0.0.1:6379`, and a disposable local test database required by the
existing state/crash suites. `READINESS_REDIS_URL` may point to a dedicated
non-production Redis database. Never point it at production.

External items intentionally remain `BLOCKED` until an operator supplies the
exact prerequisites recorded in JSON: staging SSH access, a known-good SHA,
disposable staging DB and snapshot approval, DO Spaces/restore access, isolated
restore target, configured monitor/pager, and an approved test window.

For backup and restore procedure and historical evidence locations, link
[`docs/db-backup-runbook.md`](./db-backup-runbook.md); do not copy or invent a
restore result here. Attach the actual restore command transcript, selected
object checksum, row-count baseline, duration, and database-owner sign-off to
the generated readiness evidence/change ticket.

## Staging parity checklist

The release commander must record each item as pass/fail, never “assumed”:

- Same Node major, package lock, build command, process topology, and worker
  concurrency as production.
- Same PostgreSQL and Redis major versions, TLS mode, queue settings, and schema
  migration set; staging uses isolated credentials and data.
- Same environment-variable **names** and feature flags (values remain secret).
- Same reverse proxy, request timeout, health endpoint, PM2 lifecycle, storage
  class, and provider model identifiers.
- Representative sanitized data volume and queue backlog.
- Canary accounting owner, spend caps, provider circuit, alerts, backup access,
  and restore tooling are configured.
- Known-good release SHA and rollback artifact are fetchable before deploy.
- Tenant-isolation and billing state-machine suites pass on the candidate.

## Immutable release deployment

Production deployment is manual GitHub `workflow_dispatch` only. The transport
fails locally, before creating SSH files or contacting the host, unless
`PRODUCTION_DEPLOY_CONFIRMATION` is the typed form
`DEPLOY_CITEFI_PRODUCTION_UNTIL_<unix-expiry>`. The expiry must be in the future
and no more than ten minutes away. The workflow generates a five-minute value;
do not store this variable as a secret or durable environment setting.

The host layout is:

```text
/var/www/citefi/                 # source repository; never the live build after migration
  .env.local                     # shared environment file
  releases/<sha>-<checksum>/      # immutable, independently built artifacts
  current -> releases/<release>  # atomic PM2 cutover
  .deploy/release.lock           # exclusive flock
  .deploy/release-status.json
```

The invoking CI/operator environment exports the exact clean commit, runs
`npm ci`, required validation, and `next build`, then creates a deterministic
artifact containing runtime dependencies. It records SHA-256 and byte size
before any SSH connection. The host takes an exclusive `flock`, accepts the
artifact into a mode-0700 incoming directory, verifies size/checksum and safe
archive paths, and unpacks it once into a checksum-named immutable release. The
host never runs npm or a build. A non-empty candidate `.next/BUILD_ID` is mandatory.
Forward-only, sequential migrations run from that candidate before cutover. A
database advisory lock and `citefi_schema_migrations` checksum ledger prevent
concurrent/out-of-order or edited migrations. Migration 0020 is applied in the
same transaction and its five tables, append-only trigger, and constraints are
catalog-verified before commit and cutover. `drizzle-kit push --force` is forbidden.
Migration 0021 acceptance additionally verifies the assignee column and users
foreign key, AI-request table/primary and lookup indexes/foreign keys, the
evidence-version notification uniqueness key, and every enabled append-only
trigger against its expected table and guard function.
The `current`
symlink is then replaced atomically and PM2 reloads only `citefi-web` and
`citefi-worker`; global PM2 stop operations are forbidden. Nginx continues to
proxy port 5000 and requires no document-root change.

Full application/dependency/worker health is required after cutover. Failure
atomically restores the exact prior release directory and reloads those two PM2
processes without `npm ci`, rebuilding, or changing `.next`. Schema migrations
remain forward-only. Do not delete the release named by `knownGoodRelease` in
`.deploy/release-status.json`.

The release also probes `DO_PUBLIC_HEALTHCHECK_URL` directly after local health;
connection refusal/no listener or non-2xx is a rollback condition. Failure output
includes PM2 descriptions, BUILD_ID, socket listeners, a verbose public probe,
and bounded stderr tails. PM2 runs each named process through
`scripts/process-bootstrap.ts`, limits restart storms to five delayed attempts,
and writes exit/stderr/build/listener diagnostics to owner-only files under
`.deploy/diagnostics`. If the database is unavailable the telemetry event is
spooled mode 0600 and replayed into incident intelligence when DB access returns.

### One-time host migration

Perform this once in an approved window as the `citefi` service account before
the first deployment with this contract. It preserves the currently running
artifact as the initial rollback target. Confirm that the existing
`.next/BUILD_ID` is healthy first.

```bash
set -euo pipefail
cd /var/www/citefi
test -d .git
test -s .next/BUILD_ID
test -f .env.local
sha="$(git rev-parse HEAD)"
initial="releases/bootstrap-${sha}"
mkdir -p "$initial" .deploy
rsync -a \
  --exclude '/.git/' --exclude '/.deploy/' \
  --exclude '/releases/' --exclude '/current' \
  ./ "$initial/"
rm -f "$initial/.env.local"
ln -s /var/www/citefi/.env.local "$initial/.env.local"
printf '%s\n' "$sha" > "$initial/.release-sha"
test -s "$initial/.next/BUILD_ID"
ln -s "releases/bootstrap-${sha}" current.next
mv -Tf current.next current
chown -R citefi:$(id -gn citefi) releases .deploy
```

Do not reload the legacy processes during this filesystem bootstrap. The first
immutable deployment switches `current` to the candidate and calls
`reload_one_process` in `scripts/host-release.sh`. That function compares each
live PM2 executable with the candidate configuration; when the legacy direct
Next.js/worker executable differs from `process-bootstrap.ts`, it deletes and
starts only that named process. A failed candidate performs the inverse
transition while restoring the bootstrap release.

After the first successful immutable deployment, verify both named processes
are using the bounded bootstrap wrapper before saving PM2 state:

```bash
cd /var/www/citefi
pm2 jlist | node -e '
let source = "";
process.stdin.on("data", chunk => source += chunk);
process.stdin.on("end", () => {
  const wanted = new Set(["citefi-web", "citefi-worker"]);
  const rows = JSON.parse(source).filter(row => wanted.has(row.name));
  if (rows.length !== 2 || rows.some(row =>
    !row.pm2_env.pm_exec_path.endsWith("/scripts/process-bootstrap.ts")
  )) process.exit(1);
  console.log("Both production processes use process-bootstrap.ts");
});
'
curl -fsS 'http://127.0.0.1:5000/api/health?full=1'
pm2 save
```

Provision and enable `/swapfile2` as root if it is absent; normal deployment
runs as `citefi` and deliberately refuses to create root-owned deployment
files. Ensure `flock` (from `util-linux`) and `rsync` are installed.

Staging uses the same immutable layout under `/var/www/citefi-staging`, its own
`current`, `releases`, `.deploy/release.lock`, environment file, PM2 names, port
5100, database, Redis DB, and storage prefix. Bootstrap it independently using
the equivalent paths. Never point staging's current symlink or shared
environment file at a production path.

## External monitor setup and proof

Configure an independent HTTPS monitor for `/api/health` from at least two
regions. Require a successful HTTP response **and** healthy database and canary
fields; do not treat HTTP 200 alone as healthy. Check every 60 seconds, alert
after two consecutive failures, page application on-call, and escalate to the
release commander after 5 minutes. Add a separate queue-depth/no-completion
alert and provider-circuit-open alert.

During an approved staging window, inject a synthetic failure, record monitor
detection time, pager delivery time, acknowledgement, recovery time, screenshots
or provider event IDs, and redacted checksums. Never disable production health
or interrupt production merely to prove alerting. Until this end-to-end alert
is acknowledged, the runner correctly reports the monitor drill as `BLOCKED`.

## Evidence review and go/no-go

The release commander verifies git SHA, timestamps, commands, checksums,
durations, RTO/RPO fields, blockers, and redaction. A `FAIL` or `BLOCKED` in
certification mode is no-go. Local-only `PASS` means only that local controls
passed. Store the JSON with the change ticket, link external provider evidence,
record owner approvals, and retain according to the incident/change policy.