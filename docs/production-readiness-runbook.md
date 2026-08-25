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