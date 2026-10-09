# Exact publishing approval

## Authority and assignment

The existing `owner`, `admin`, `member` and `client_viewer` roles are unchanged.
An unassigned review belongs to the content-owning team; its current owner,
admin or member may decide. An explicitly assigned client-team review can only
be decided by a current reviewer in that team, including `client_viewer`.
Content-team owners/admins may explicitly assign or unassign an active child
team by requesting a fresh review. Members may request review but cannot change
assignment. Client reviewers cannot request review, edit content or publish.

There is **no administrator approval override**. An owner/admin must explicitly
unassign a client review, acknowledge revocation, and review a new exact manifest.
Platform administrator status alone does not confer team publishing authority.
Every assignment/status decision is audited atomically. Changing assignment or
requesting a new review clears active consent, without deleting old evidence.

Reviewer and publisher must remain active members, with the same role and
membership incarnation. Removing/re-adding a member does not revive consent.
Current role changes, suspension, account deletion or workspace archival block
admission/dispatch. Restoring the same role on the same membership restores that
role's authority unless a fresh review request revoked consent. Role changes
are not a new permanent ban mechanism.

The row-locked dispatch claim is the authorization boundary: revocations
committed before it block sending. Revocation cannot recall an already claimed
external request. An immutable approved payload/credential revision is used
after claim, not subsequent mutable reads.

## Review record and assets

The existing approval timestamps/reviewer select an append-only
`article_exact_review_approved` activity record containing the full manifest,
SHA-256 digest, reviewer membership fingerprint, unique review identity and
destination account fingerprint. No schema migration or legacy backfill is
required. Operational log cleanup excludes exact and legacy approval evidence.
User/account deletion retains its existing privacy behavior; removed evidence
or reviewer authority always disables publishing, never grants substitute consent.

The manifest reuses the website formatter, canonical storage object keys, and
the owning Campaign's frozen Brand snapshot. It binds original content,
material metadata, asset records and original bytes, destination connection
identity, effective HTTPS origin, credential revision and capabilities. Secret
credentials are not put in audit records, preview JSON or media URLs.

Only tracked, owned media under the article's durable storage prefix is admitted.
Remote/data URLs, unowned media, unsupported formats, untracked inline media,
srcset and CSS media references fail closed. Supported extensions: PNG, JPEG,
WebP, MP3, WAV, OGG and MP4; maximum 32 MiB per asset, 96 MiB per review.
These constraints are explicit compatibility gates, not inferred approval.

Preview pins bytes under a team-scoped content-addressed namespace.
Production writes use `If-None-Match: *`; an existing copy is re-read and hashed.
Admission and dispatch re-hash original bytes and verify immutable copies.
Receivers download only the pinned version through a key-scoped signed link;
the download hashes bytes again, rejects corruption and never falls back to a
different version. Links expire after 30 minutes and are freshly signed at
dispatch, so an old browser preview does not expire a delayed queued job.

## Changes, history and duplicates

The approval POST must echo the preview's exact digest. Changed content, media,
account credentials, assignment or request epoch returns 409. Browser content
editors retain the version from when editing began; an atomic conditional save
rejects stale writes. Fresh saves revoke current consent. Alternate writers
are additionally fenced by approval freshness and the manifest comparison.

Legacy approved articles and queued jobs without the bound review/publisher
identity remain historical but cannot publish. Article and article-backed
podcast publishing are supported; video/social workflows remain fail closed.
Identical concurrent admission reuses one durable job/queue identity.
Re-review does not implicitly authorize an old job: its review identity must
still match. Existing ambiguous-outcome, callback and retry fences remain intact.

## Verification and rollout

`npm run test:publishing-approval` uses owned disposable PostgreSQL/Redis.
Storage bytes and receiver acceptance in that suite are explicit local fixtures,
not live-provider acceptance evidence. `QA/support/auth-http-ui-server.ts
--publishing-review` starts a separate signed-in browser fixture with owned
filesystem media. Never run QA against customer data or the normal app port.

No shared/production migration, paid generation, real publication, credential
rotation or deployment is authorized by this implementation. The normal runtime
still requires configured publishing encryption, session signing, engine URL
and primary storage. Staging/production receiver compatibility and storage
conditional-write support need separately authorized checks before certification.


## Governed retention of abandoned preview copies

`scripts/retain-publishing-review-copies.ts` is a **manual operator tool**, not a
scheduled cleanup, public endpoint or team-admin permission. This change
authorizes **no production deletion**. Do not run `execute` on a shared or
production target without separate, explicit authorization for the exact plan.
Provider conditional-delete behavior must be certified on an owned staging
fixture before any production use. Never use a generic bucket lifecycle rule
on `private/publishing-reviewed/`: age alone cannot distinguish consent evidence.

The process inventories only the primary storage namespace, with all pages and
the configured storage prefix. It never deletes original article media,
uploads, another namespace or legacy-bucket objects. Every team/hash key is
distinct, even when identical bytes exist in different teams.

Reference discovery reads complete rows (including JSON, historical audit and
soft-deleted data) from `teams`, `articles`, `article_assets`, `activity_logs`,
`publishing_jobs` and `publishing_callbacks`. Every referenced version is retained
without a time limit. All job statuses are protected, including pending, queued,
processing, sent, uncertain, delivered, failed, cancelled and unknown statuses.
Job review IDs must resolve to the owning article/team's exact audit record.
Missing/malformed history or legacy approved content blocks that team's
cleanup; unparseable media references or orphan callbacks block all candidates.
No reference-query failure or RLS-filtered scan can certify orphanhood. BullMQ
publishing work holds database job IDs, not independent disposable media grants.

Only genuinely unreferenced copies in an active, non-deleted team with an explicit
reviewed policy may become candidates. The policy requires:

* A target fingerprint binding the actual database identity and primary storage
  endpoint/bucket/prefix, plus an opaque governance reference.
* A per-team retention period of at least seven days (longer than the 30-minute
  preview-link lifetime), no legal hold, and `delete-unapproved-orphans`.
* `approvalHistoryComplete: true`, independently certified by the operator.
  An absent audit row after privacy erasure, a partial restore or historical
  pruning is **not** proof that a copy was never approved. Without that
  certification, keep the team on hold.

Deleted/archived teams, unknown teams, absent rules, retain dispositions and
uncertified history stay on hold. This is **not** an account-erasure or approved
evidence-expiry process. Existing privacy/account deletion remains separate;
after evidence erasure, set history completeness to false. A legal/privacy
decision to remove referenced media needs a separately governed process that
revokes consent and reconciles pending/sent/uncertain operations first.

### Read-only DigitalOcean preflight — 2026-10-09

The separately authorized manual inspection reused the existing GitHub SSH
secrets and passed pinned host verification and SSH authentication:
[inspection run](https://github.com/bocsitcourier/citefi/actions/runs/37883323350).
No credentials were copied back to the workspace. No deployment, service restart,
storage request, bucket creation, publication or generation was performed.

- Production's literal `.env.local` specifies bucket `citefi`, endpoint
  `https://nyc3.digitaloceanspaces.com`, and has nonempty Spaces credential fields.
- Staging's literal configuration has Spaces credential fields and the isolated
  `staging/synthetic/` prefix, but no valid literal bucket or Spaces endpoint.
  Its database and Redis configuration identify the expected local staging
  database and Redis DB 1.
- No staging HTTPS application origin or sufficiently long session-signing
  secret was found in the inspected file. The production file points its
  application origin at a Replit hostname. These are file observations only;
  process-manager/injected environment values were not inspected.

The inspection intentionally does not evaluate shell/environment substitutions
or import the application. Credential presence is not proof of usable access.
Bucket existence, conditional-write support, effective runtime isolation,
receiver compatibility, delayed downloads and delivery counts remain
**unverified**. A green inspection must not be represented as live-media
acceptance or permission to modify production.

### Authorized staging storage configuration — 2026-10-09

The user separately authorized **staging storage configuration only** using
the existing `citefi` bucket in `nyc3` and the `staging/synthetic/` prefix.
The manual, default-branch-only configuration workflow reused GitHub SSH
credentials and existing staging Spaces credentials:
[successful configuration run](https://github.com/bocsitcourier/citefi/actions/runs/37883648199).

The remote operation verified the staging database/Redis isolation configuration,
successfully performed `HeadBucket` against `citefi`, atomically saved the three
nonsecret staging storage settings, and re-read them successfully. This supersedes
the missing staging bucket/endpoint observation in the earlier file preflight.
The operation did not create a bucket, write objects, change credentials, modify
production, or restart services. The saved configuration has **not** been
certified as loaded by the existing staging application/worker processes.

This grants no additional authority for receiver delivery, synthetic object
writes, credential revisions or runtime changes. Conditional create-only writes,
digest-checked receiver downloads, delayed-job link refresh, asynchronous download
timing and duplicate-delivery fences still require the separately authorized
live receiver/storage acceptance work.

### Authorized real Spaces preflight — 2026-10-09

The user subsequently authorized staging-only synthetic media writes, runtime
startup/reload, test deliveries and test credential revisions. No application
or receiver HTTPS URL was supplied.
[Live storage preflight](https://github.com/bocsitcourier/citefi/actions/runs/37884165482)
then exercised the actual DigitalOcean SDK/provider, not a fixture store:

- Create of a 68-byte synthetic PNG with `If-None-Match: *` succeeded.
- Downloaded bytes matched SHA-256
  `6b1048f8a6d40bac0b2954c18fefa40c4ea7a96120fc2e54b7317c0e43c2bbec`.
- A conflicting conditional create returned HTTP **412**.
- A second download still matched the original digest and length.
- One tiny evidence object remains under the exclusively owned test key
  `staging/synthetic/publishing-live-qa/9d5ddeb7-0e0a-4211-b6f4-8adaef43e294/6b1048f8a6d40bac0b2954c18fefa40c4ea7a96120fc2e54b7317c0e43c2bbec.png`.
  No pre-existing objects were read, overwritten or deleted.

Read-only discovery of enabled nginx site files found no HTTPS server block
pointing to staging port 5100. The staging environment file still has no HTTPS
application origin or sufficiently long session-signing secret. Known receiver
configuration locations within staging contained no HTTPS receiver origin.
These observations do not rule out externally configured routes, injected
runtime variables or a receiver hosted elsewhere.

The storage check passed, but **full publishing acceptance remains blocked**:
no confirmed isolated staging application/receiver targets are available.
The actual application media endpoint, delayed-job link refresh, credential
revision rejection, receiver download window and duplicate external-delivery
count have not been verified live. No services were restarted and no external
delivery, paid generation or production change occurred. Do not substitute a
customer/production origin or bypass HTTPS/SSRF safeguards to finish the test.

### Completed isolated HTTPS receiver acceptance — 2026-10-09

This supersedes the blocked preflight above. The user authorized remaining
staging-only setup and tests using existing saved infrastructure access.
The existing `citefi` Space was configured; **no new Space was created**.

- Application media origin: **https://citefi.co:8443**.
- Real bundled receiver: **https://citefi.co:8444**; health endpoint
  `/api/v1/status/ping`.
- Storage remains exclusively under `staging/synthetic/` in `citefi`, `nyc3`.
- [Successful server setup](https://github.com/bocsitcourier/citefi/actions/runs/37892021546)
  and [successful live acceptance](https://github.com/bocsitcourier/citefi/actions/runs/37892105221).
- Pinned application/receiver/test source SHA-256:
  `6cb3fbdda254edec7f448e3407561ef7017527b5822ca6000f2df4c485869c50`.

All **23 live cases passed**, using disposable, owned PostgreSQL/Redis and
actual Spaces operations, the deployed signed-media endpoint, the actual
website publisher transport, and the actual receiver download/storage code.
The earlier real Spaces probe separately proved conflicting create-only writes
return 412 without replacing original bytes.

The successful run proved:

1. Downloads retained by the receiver match the exact approved SHA-256.
   Wrong pinned bytes fail closed; required media failures cannot silently
   publish partial content, and only newly written request files are cleaned.
2. An actually expired preview URL returns 404 from the deployed application.
   A job whose creation timestamp is aged 31 minutes gets newly signed links
   and successfully downloads the same immutable byte version. Only link
   issuance timestamps are aged; SDK signing and receiver clocks remain real.
   This is controlled timestamp aging, **not a 31-minute wall-clock wait**.
3. Credential/account revisions after approval/admission reject before delivery.
   Role revocations, cross-tenant attempts and stale approvals remain fenced.
4. Concurrent workers cause **one actual receiver submission**. Destroying the
   synthetic successful response after the receiver has downloaded and stored
   the article leaves the sender outcome ambiguous. Reprocessing does not
   submit again; the receipt count remains one with the correct downloaded hash.
5. The actual receiver completes awaited downloads before responding. A
   staging-only 1.5-second ingress delay exercises availability after dispatch;
   receipt timing remains inside the sender's 30-second window. Reviewed
   downloads have a 20-second timeout and 32-MiB cap; links last 30 minutes.
   **Post-response/202 background downloading is not certified or supported by
   this receiver contract.**

#### Isolation and scope

The services run as the existing `citefi` account in owned checksum-named
staging directories. Root performs only the fixed infrastructure operations.
Production application files, data and credentials were not changed or rotated;
paid generation and customer publication were not performed. The shared nginx
configuration was syntax-checked and reloaded for the two staging-only TLS
ports; production port 443 was not repointed. Synthetic evidence objects and
receiver files are retained, not deleted.

The media service uses Next development mode with webpack and isolated staging
secrets. This certifies the media/receiver contract, **not production build
parity or normal staging sign-in**. Because cookies are hostname-scoped rather
than port-scoped, both proxies discard cookies and hide `Set-Cookie`; staging
must not reuse production sessions. Responses are marked `noindex, nofollow`.

The receiver performs its normal callback attempt, but the staging proxy
returns 404 for `/api/publishing/callbacks`: the acceptance jobs belong to a
disposable database, not the deployed staging database. This also avoids
compiling the unrelated worker graph on the shared host during media tests.
Callback durability, crash recovery and reconciliation remain separate checks;
this run does not claim to certify them.

#### Repeatable operation

The manual `staging-publishing-server` workflow runs only from the reviewed
default branch, pins the GitHub-held SSH host fingerprint, verifies the source
archive checksum and rejects unsafe archive entries. `setup` starts only the
named staging services; `verify` runs the owned live harness. Existing offline
guards remain unchanged. The separate live guard permits only the authorized
staging HTTPS targets, Spaces endpoints and owned local test-service ports.
Private configuration and detailed logs stay owner-only on the server.


#### Bounded staging source retention

Retention applies **only** to direct `source-<64 lowercase hex>` directories in
`/var/www/citefi-staging/publishing-qa`. It never cleans production, normal
staging releases, GitHub-sync recovery files, incoming archives, private QA
configuration/evidence logs, receiver uploads, or Spaces objects.

The policy keeps the three newest snapshots, every snapshot less than seven
days old, all active sources, and the full transitive symlink dependency graph
of **every kept snapshot**. Intermediate dependency targets are preserved even
when a link chain resolves ultimately to a different snapshot. Active references
come from read-only live `/proc` inspection, saved PM2 state, `setup.json`, and
the staging process configuration, including stopped or failed-start sources.
Unknown/linked release roots or cyclic kept dependency links fail closed.

An unreferenced older release is eligible only when it has no private logs or
retained media. Frozen source exports include a hash inventory of shipped media:
unchanged application assets are source, while changed or untracked media
protects the entire release. Package media fixtures inside `node_modules` are
not retained receiver media. Legacy snapshots without an inventory conservatively
retain any media they contain; do not invent an inventory to make them eligible.
Evidence and retained media require separate authorization, not this cleanup.

Setup reserves 4 GiB for extraction/dependency installation and requires another
4 GiB of free filesystem space. Allocated blocks of all source snapshots plus
the setup reservation must fit a 12 GiB source budget. These are admission limits,
not permission to delete protected data: protected snapshots may exceed the
budget, in which case setup stops. `prepare` checks archive-upload headroom too;
setup also rechecks the budget after installation, before changing services;
the local exporter checks temporary-disk headroom before building its archive.
Existing checksum directories cannot be overwritten by setup, including failed
attempts. Use a newly reviewed export, or wait for authorized eligible cleanup.
No install/build is run inside an active or reused dependency tree.

Use the manual default-branch `staging-publishing-server` workflow:

1. Run **`retention-preview`**. This is read-only: no deletions, service restarts,
   PM2 daemon startup, credential output, or saved plan files. Review candidate
   names, protected reasons, allocated/reclaimable bytes, free space and limits.
2. Only after approving those deletions, run **`retention-cleanup`** with
   **`retention_digest`** copied from that preview. Cleanup recomputes the plan
   against current live references. Changed candidates, dependency links, active
   roots or protection decisions invalidate the digest before any deletion.
   Run another preview rather than bypassing this check.
3. Run `retention-preview` again if desired to inspect the remaining capacity,
   then explicitly run setup with a reviewed new source digest.

The shell wrapper also accepts `STAGING_OPERATION=retention-preview`, or
`STAGING_OPERATION=retention-cleanup` and `STAGING_RETENTION_DIGEST=<preview digest>`.
Both use the existing pinned SSH transport; neither runs automatically on setup.
Setup, verification and cleanup share an exclusive operation lock. An interrupted
controller may leave `.source-operation.lock`: inspect running maintenance
processes before an administrator removes that empty lock directory. Cleanup is
not a scheduler or a blanket authorization to manage other shared-host files.

Offline safety checks:
`node --test tests/deployment/staging-publishing-server.test.cjs tests/deployment/staging-source-retention.test.cjs`.
### Operator procedure (requires separately authorized target access)

No commands below were run against shared/production data as part of this change.
Use the configured operator environment; do not copy secrets into command lines
or evidence. Invoke with `node --import tsx/esm`, without automatically loading
an unverified `.env` file. The privileged maintenance database role must actually
have BYPASSRLS/superuser visibility. A tenant-scoped role is rejected.

1. Prepare a policy JSON. Start with a zero fingerprint to discover the target:

   ```json
   {
     "version": 1,
     "policyRef": "opaque-governance-reference",
     "target": "0000000000000000000000000000000000000000000000000000000000000000",
     "teams": [{
       "teamId": 123,
       "orphanRetentionDays": 30,
       "disposition": "retain",
       "legalHold": false,
       "approvalHistoryComplete": false
     }]
   }
   ```

   ```sh
   node --import tsx/esm scripts/retain-publishing-review-copies.ts dry-run \
     --policy /restricted/policy.json --out /restricted/target.json
   ```

   Zero-target discovery emits only the fingerprint, never candidates. Independently
   verify the selected environment, database and storage identity. Update the
   target and team policies only after retention/privacy/history review.

2. Produce a dry-run plan with a new output path:

   ```sh
   node --import tsx/esm scripts/retain-publishing-review-copies.ts dry-run \
     --policy /restricted/policy.json --out /restricted/plan.json
   ```

   The report includes every inventoried key, metadata, team, candidate/retain
   decision and reason, and counts. Console output supplies `planHash`; the plan
   contains `target` and `policyHash`. Reports contain no content, reviewer
   identity, credentials or signed links, but object identifiers are still
   sensitive. Files are exclusively created with mode 0600. Keep them outside
   public assets/source control, under the organization's privacy/evidence
   retention policy. No automatic report/journal expiry is introduced.

3. **Only after separate deletion authorization**, create an authorization JSON
   with `version: 1`, an opaque `authorizationRef`, the exact `target`,
   `planHash`, `policyHash`, an ISO `expiresAt`, `allowDeletion: true` and
   `conditionalDeleteCertified: true` (only after the owned provider check).
   Possession of a file is not an application role grant: this is a restricted
   operator change-control record, not a signature or a client API. Restrict
   filesystem/database/storage access accordingly.

   ```sh
   node --import tsx/esm scripts/retain-publishing-review-copies.ts execute \
     --policy /restricted/policy.json --plan /restricted/plan.json \
     --authorization /restricted/authorization.json --journal /restricted/run.jsonl
   ```

   Plans older than 24 hours, expired/mismatched authorization, policy changes
   and target changes are rejected. Execution takes an exclusive transaction
   advisory lock shared with all manifest pin/read paths, then SHARE table locks
   over every reference source. Fresh references and inventory are checked
   before deletion while those locks remain held. Newly eligible copies are not
   added to an already approved plan. Changed/protected/missing candidates are
   skipped. The minimum age prevents immediately abandoned previews becoming
   disposable; an old unapproved preview deleted after expiry requires a fresh
   preview rather than substituting bytes.

   Metadata is checked again with HEAD, and each delete uses the approved ETag
   as `If-Match`. Invalid/wildcard ETags are rejected. There is no unconditional
   delete fallback, legacy fallback or storage-error suppression. Ordinary
   storage deletion rejects this reserved namespace.

   An fsynced journal intent must succeed **before** each deletion. Deleted and
   skipped outcomes are recorded. A journal/storage/lock error stops the batch;
   earlier object deletions cannot be rolled back by a database rollback. An
   intent without a successful result is uncertain: investigate that exact key,
   do not automatically retry or call the run successful. Each invocation uses
   a new journal path, never silently overwrites evidence or resumes a run.
   The command may briefly block publishing/privacy writes; lock contention
   fails after five seconds and requires a fresh operator decision.


### Retention verification

`npm run test:publishing-retention` runs offline policy/plan/execution tests and
an owned disposable PostgreSQL barrier test. It covers team isolation,
historical references, every job status, lost/ambiguous evidence, privacy/legal
holds, metadata changes, exact-plan authorization, durable journal failures,
and both directions of the concurrent pin/reference barrier. No real storage
deletion, production inventory, live credentials or customer data are used.
This is not certification of the storage provider's conditional-delete behavior.
