# RC-1 queue worker report

**Status: `FIXED_UNVERIFIED`**

This is source-only remediation evidence. The worker did not restart the
application, start a worker, run a provider, write to PostgreSQL, publish
externally, or mutate the canonical remediation state file.

## Root-cause proof

The queue inventory found one production `Queue` constructor in `lib/queue.ts`,
14 production `Queue.add` call sites in that module, one production
`Queue.addBulk` caller in `lib/citation-probe-worker.ts`, and no
`FlowProducer` callers. Before this change, the following custom-ID paths still
constructed colon-bearing IDs:

| Path | Historical/current construction | Result |
| --- | --- | --- |
| Podcast | `podcast:${articleId}` and `podcast:${articleId}:${hash}` | New enqueue IDs are canonical and colon-free; both legacy forms remain lookup candidates. |
| Social fallback | `social:${socialPostId}:${uuid}` | New fallback IDs are canonical; the application singleton/dedupe key remains exact and is looked up verbatim for legacy jobs. |
| Publishing | `publishing:${dbJobId}` | New enqueue IDs are canonical; the old string remains a lookup candidate. |
| Intelligence campaign | `intelligence:campaign:${campaignId}` | New enqueue IDs are canonical; the old string remains a lookup candidate. |
| Daily brief, video, article, batch | Existing stable IDs plus legacy candidates | Existing stable IDs are unchanged; legacy lookup/recovery remains explicit. |

`creditRunId`, article `billingJobId`, cap-settlement job IDs, and other
billing/idempotency identities are not queue custom IDs. They remain unchanged
in payloads and billing calls. Queue IDs derived from those values hash the
opaque value only at the enqueue boundary.

## Changes

- Added `canonicalQueueJobId(namespace, key)`, using a strict
  `[a-z0-9_-]` namespace and a complete SHA-256 digest of opaque application
  keys. No BullMQ maximum was invented.
- Kept the existing `stableQueueJobId` output unchanged for already-valid
  stable IDs.
- Added typed `InvalidQueueCustomIdError` and validation rejecting empty,
  colon-bearing, and purely numeric custom IDs. The stricter
  `[a-z0-9_-]` convention is enforced by the new canonical helper only; the
  enqueue validator does not invent an additional BullMQ character policy.
- Added `enqueueQueueJob` and `enqueueQueueJobs` as the common validation
  boundary; migrated every production `Queue.add`/`Queue.addBulk` caller.
- Added current/legacy candidate helpers and verbatim legacy lookup for
  podcast, publishing, intelligence, social dedupe, batch, daily brief, and
  video recovery paths. Legacy strings are never normalized or re-hashed as
  new IDs.
- Kept the broad podcast candidate list restricted to historical settlement
  recovery. Enqueue and ambiguous-write recovery now use only the same-attempt
  candidates: canonical plus credit-scoped legacy when `creditRunId` exists,
  or canonical article plus generic legacy when it does not.
- Preserved duplicate suppression and ambiguous accepted-write recovery.
- Preserved all queue names and job names.

## Test coverage added or updated

- `tests/batches/queue-custom-id-contract.test.ts`
  - canonical format and deterministic collision-resistance checks;
  - typed invalid-ID rejection before `Queue.add`;
  - real localhost-only Redis `addBulk`/read/remove coverage;
  - publishing, intelligence, and social enqueue coverage;
  - duplicate suppression and exact `creditRunId` payload preservation.
- `tests/podcast-queue-real-add.test.ts`
  - real localhost-only Redis podcast enqueue/read/remove;
  - colon-free new ID;
  - historical run-scoped lookup compatibility;
  - unrelated retained generic legacy job does not suppress or satisfy a
    newer credit-scoped attempt;
  - exact `creditRunId` and cap-reservation payload preservation;
  - ambiguous accepted-write recovery.
- `tests/batches/queue-real-id.test.ts`
  - fixed Redis target to `127.0.0.1:16379` and retained batch/article/image/
    daily brief IDs and invalid legacy rejection.
- `tests/batches/video-queue-real-id.test.ts`
  - removed environment URL mutation and asserted exact durable credit identity
    preservation for real video jobs.
- `tests/helpers/isolated-redis.ts`
  - one dedicated test-only loopback endpoint constant (`127.0.0.1:16379`).

## Sanitized static evidence

```text
npx tsc --noEmit --pretty false
exit 0
no output

production direct Queue.add/Queue.addBulk callers outside the boundary: 0
production enqueueQueueJob callers: 14
production enqueueQueueJobs callers: 1
FlowProducer callers: 0
production Queue constructors: 1 (the shared lib/queue.ts registry)

git diff --check
exit 0
no output
```

The installed BullMQ parser permits at least some three-segment colon IDs
(the real fixture `daily-brief:1:2099-01-02` is accepted), so the Redis
regression tests no longer claim that the vendor rejects every colon form.
They insert that vendor fixture where supported, remove it, and separately
assert that the application `enqueueQueueJob` boundary rejects it with
`InvalidQueueCustomIdError`. The two-segment generic podcast legacy ID is
represented by an explicit historical `getJob` response in the compatibility
test; it is not forced through the installed vendor parser. The exact
three-segment credit-scoped podcast legacy ID remains a real Redis fixture.

The worker did not execute the Redis suites because the delegated worker
policy leaves runtime testing to the main agent. The targeted suites above
must be run by the main agent against isolated queues on the dedicated
`redis://127.0.0.1:16379` endpoint, with no worker process and no injected
`REDIS_URL`; no runtime pass is claimed here. A zero-Redis run must fail the
integration tests rather than skip them or emit pass metadata.

## Changed files

- `lib/queue.ts`
- `lib/citation-probe-worker.ts`
- `tests/batches/queue-custom-id-contract.test.ts`
- `tests/batches/queue-real-id.test.ts`
- `tests/batches/video-queue-real-id.test.ts`
- `tests/podcast-queue-real-add.test.ts`
- `tests/helpers/isolated-redis.ts`
- `reports/qa-remediation/rc1-worker.md`
