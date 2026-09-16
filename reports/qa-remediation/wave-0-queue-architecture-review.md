## Current principal decision — architecture gate resolved

The principal authorized `retain_redis`: keep Redis/BullMQ as Citefi's
canonical production queue and correct the architecture/deployment
documentation, including managed Redis deployment, availability, and security
ownership. The July 22 migration predates RC-1. No queue conversion or rollback
is authorized. The former `BLOCKED_HUMAN` gate below is historical and resolved;
the next authorized scope is Wave 0 step 2 RC-7 reconciliation only.
The paid/shared-cap gate remains separate and is not cleared. RC-3 remains
unapproved `IN_PROGRESS`, and no later wave is authorized.

### Historical gate at review time (resolved, wording preserved)

> **BLOCKED_HUMAN: do not alter RC-1 or migrate queues until a human either authorizes Redis/BullMQ as production infrastructure or commissions a separately scoped return to pg-boss/Postgres.**

**Critical findings / analysis**
- Actual runtime architecture is Redis/BullMQ, not pg-boss. `lib/queue.ts` creates BullMQ queues through ioredis using `REDIS_URL`, falling back to `redis://127.0.0.1:6379`; `server/index.ts` starts the worker process/local development Redis, and `server/worker-process.ts` registers BullMQ workers. Current source has no pg-boss runtime import; `pg-boss` remains only as a stale dependency/documentation claim.
- Git history establishes the migration predates RC-1. Commit `86bdafb` on **2026-07-22 22:33:14Z** explicitly migrated pg-boss to BullMQ: its parent used `PgBoss` and had no BullMQ/ioredis dependencies; the commit added both dependencies and lock entries, replaced the production queue registry, added Redis startup/configuration, and exposed port 6379 in Replit configuration. Follow-up `6476576` completed naming/call-site cleanup.
- RC-1 commit `6939f8d` on **2026-09-16 14:33:06Z** did **not** introduce Redis. Its parent already imported BullMQ/ioredis, used `REDIS_URL`/6379, and had BullMQ workers. RC-1 only hardened custom job IDs/enqueue boundaries and tests atop that architecture.
- RC-1’s `127.0.0.1:16379` was an isolated test-only Redis endpoint and was stopped after acceptance tests. It is distinct from application Redis at `REDIS_URL` or fallback/local port 6379.
- No files, services, tests, providers, databases, or remediation state were changed. Existing RC-3 working-tree changes remain unreviewed/unapproved and untouched; task 179 was not touched.

**Security:** None observed within this read-only architecture trace.

**Historical next actions (superseded by the principal authorization)**
1. Human must answer: **“Authorize Redis/BullMQ as Citefi’s intended production queue, including managed Redis deployment/availability/security, and update canonical architecture/deployment contracts—or require a separately scoped migration back to pg-boss/Postgres?”**
2. Stop here pending that decision; perform no rollback, migration, RC-3 review, RC-7/task-179 work, or later-wave activity.

**Current next action**

1. Proceed only with Wave 0 step 2 RC-7 provider-cost reconciliation under
   task 179 ownership; do not duplicate work or treat its `IMPLEMENTED`
   notification as landed/merged/reconciled evidence.
2. Keep the shared-cap/reconciliation gate blocked for any future paid work.
   Make no provider call, queue conversion, rollback, RC-3 approval, or later
   wave change in this documentation handoff.