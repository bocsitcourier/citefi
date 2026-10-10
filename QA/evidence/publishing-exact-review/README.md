# Exact publishing review evidence

Implementation and policy: `docs/publishing-exact-approval.md`.

Verification is local/isolated, **not production certification**.

- TypeScript: `npx tsc --noEmit --incremental false`, PASS.
- Offline policy regressions: 24 PASS, 0 failures/skips.
- Existing publishing database/API regressions: 14 PASS, 0 failures/skips.
- Exact review database/API regressions: owned disposable PostgreSQL/Redis;
  original media bytes and receiver acceptance are explicit fixtures.
  22 PASS, 0 failures/skips.
  Coverage includes source-byte/asset-metadata/content changes before review
  save, asset insertion, stable-origin credential changes, pre-admission byte
  and account changes, eight simultaneous API admissions, delayed mutation,
  reviewer/publisher role revocation, replaced memberships, stale editor saves,
  fresh-save invalidation, correct queue evidence correlation, assigned client
  authority, explicit admin unassignment, tenant denial, simultaneous dispatch,
  immutable-copy corruption and expired-preview link renewal.
- Main development workflow starts; public homepage screenshot inspected.
  Existing workspace publishing encryption configuration is still absent;
  tests use synthetic configuration and do not change real configuration.
- Signed-in review browser verification uses `--publishing-review` mode in the
  owned private fixture. Its initial queue failure exposed a fixture-grant gap
  and an evidence-correlation issue; the owned fixture now installs the real
  RLS policy, and the queue has a scoped system read and qualified correlation.
  The resumed browser journey PASSed queue loading, destination/payload/account
  metadata, version-pinned PNG downloads, confirmation-gated single approval,
  Approved queue state, fresh-review confirmation reset, and feedback/status
  persistence for Changes Requested. Fixture images are 1×1 pixels: downloads
  were verified, not visual quality. Login/reload produced transient resource
  and hydration warnings; no further review/decision errors were observed.
  Screenshot IDs from the browser check: `pzk7c1`, `pr51p5`, `rm4h8g`, `2zr2f1`.

No shared database migration, paid generation, real receiver publication,
production database change, credential rotation or deployment was performed.
Approval audit history is reused; no schema backfill is needed. No historical
publishing operation or customer asset was deleted to make tests pass.

Raw local outputs: `integration.log`, `policy.log`, `types.log`. Disposable
integration services are stopped and removed by their owning harness.
