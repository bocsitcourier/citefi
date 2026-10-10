# Publishing outcome reconciliation

## Boundaries

This reconciles **publishing delivery only**. It never settles paid generation,
releases credit/spending-cap holds, repairs provider billing, or sends historical
generation jobs. Unknown and legacy publishing operations remain non-retryable.
A receiver timeout, HTTP error, missing post, `404`, or signed failure callback
does **not** prove non-acceptance.

Original rows retain public ID, attempt count/timestamp, dispatch hash, receiver
origin/key fingerprint, prior error, receipt provenance, approval checks and
append-only service audit events. Attempted jobs and linked replacement jobs
cannot be removed through the individual/bulk publishing deletion APIs.

## Operator procedure

1. A current team owner/admin (including an authorized inherited agency admin),
   or active platform administrator, opens **Settings → Publishing → Reconcile**.
   Ordinary members and client reviewers cannot inspect or change evidence.
2. Import the **exact signed native JSON** and its public signature, obtained
   from the original receiver's private durable receipt ledger. Never paste
   an API key. Importing evidence does not adjudicate or send.
3. Alternatively, explicitly authorize one read-only check of the **displayed,
   original receiver origin**. This is optional, never runs on page load or in
   a scheduled reconciliation loop, and requires advertised native receipt
   capability. No live receiver access was authorized for this task's QA.
4. Select a verified receipt, enter a meaningful reason, and record a decision.
   The server—not a selectable outcome field—derives accepted/not-accepted.
   The decision uses locked current membership and compare-and-swap against
   the exact job status, attempt and update timestamp. Refresh a stale view.
5. Accepted proof marks the original Delivered with the native same-origin
   HTTPS publication URL. Not-accepted proof marks it Proven not accepted,
   **without resetting it** or queuing any new request.
6. Only a proven, irrevocably fenced not-accepted decision may authorize a
   **separate new operation**, using the explicit confirmation. It rechecks
   current content approval, unchanged formatted content and receiver identity,
   active workspace/connection, and absence of conflicting accepted evidence.
   Concurrent repeats reuse one linked new job; they never reset the original.
   Late contradictory accepted evidence is retained and blocks pending
   replacements before submission. Conflicts require investigation, not retry.

The private evidence endpoint is
`/api/publishing/jobs/:id/reconciliation`. Read-only clients receive only safe
delivery summaries for content assigned to their client team through a narrow
database function; they retain no raw publishing-record, receiver-key, signature,
operator-reason or audit access. Apply the registered
`0037_publishing_client_summary.sql` migration using the existing versioned
post-merge migration runner; no existing migration checksum was changed.

## Native receiver protocol and deployment requirements

The bundled receiver source advertises `publishingReceiptV1` only after the
receiver operator sets `PUBLISHING_RECEIPT_FENCE_READY=true`, explicitly confirming
the claim volume is durable and shared by every process serving that site.
Until then, a rejection cannot emit native not-accepted proof and stays unknown.
Accepted receipts can still be retained; ordinary legacy publishing is unchanged.
Build/deploy that receiver separately through its normal release procedure;
this task does not publish a package or contact customer receivers. Existing
receivers and old jobs do not acquire trustworthy proof merely by upgrading.

New signed submissions carry public `jobId`, canonical `dispatchAttempt`,
`contentHash`, and `receiverOrigin`, bound by the engine's original submission
record. The receiver atomically creates a per-public-job claim **before any
publication effect**. A validation rejection recorded before all effects may
emit final `not_accepted` with `operationFenced: true`. Successful committed
publication emits `accepted` with its page URL. Partial work, process death,
missing receipt, or uncertain storage remains unknown; claims are never reset.

Receipt JSON has `version: 1`, a native `receiptId`, the four submission anchors,
`outcome`, `final: true`, `operationFenced`, `observedAt`, and, for accepted,
`pageUrl`. Its public HMAC-SHA256 signature covers the exact bytes of
`publishing-receipt-v1.<raw JSON>` using the original receiver key.

The optional engine check is a bounded DNS-pinned **GET** at
`/api/v1/publishing/receipts/<publicId>?dispatchAttempt=<encoded canonical time>`.
It sends `x-citefi-timestamp` and `x-citefi-receipt-read-signature`, the latter
covering `publishing-receipt-read-v1.<timestamp>.<path+query>`. The receiver
authenticates before reading and returns exact receipt JSON with
`x-citefi-receipt-signature` and `Cache-Control: no-store`. No redirects are
followed, all DNS answers must be public, and the total time/response limits
are 5 seconds/32 KiB. Not found or any other inconclusive result stays unknown.

The receipt ledger lives beside—not inside—the public upload directory,
in `.publishing-operations`. It contains no content payload or API key.
It must be on an **owned persistent filesystem with durable atomic mkdir,
exclusive-create, rename and fsync semantics**. All receiver processes serving
the same site must share that same durable claim store. Do not use independent
ephemeral per-replica disks or remove unknown claims during recovery. Moving,
restoring or replacing a receiver must preserve this ledger as well as content.
Multi-host distributed receivers need an equivalent shared durable CAS ledger;
an unverified/fresh filesystem is not evidence of non-acceptance.

## Offline verification

```sh
bash QA/support/with-isolated-database.sh --with-redis --direct -- \
  tests/security/publishing-reconciliation-db.test.mjs \
  tests/security/platinum-publishing-db.test.mjs
bash QA/support/run-offline.sh -- \
  tests/security/publishing-native-receipts.test.ts \
  tests/security/platinum-publishing-policy.test.ts \
  tests/security/publishing-scheduling-hardening.test.ts \
  tests/security/url-validation-independent.test.ts
npx tsc --noEmit
npx tsc --noEmit --project packages/apex-receiver/tsconfig.json
```

The DB suites use an owned disposable PostgreSQL/Redis pair. Authorized GET
verification uses stubbed DNS/HTTPS transport, not a receiver socket. Native
receipt tests use an owned temporary private filesystem. Browser QA can opt in
to `QA_PUBLISHING_RECONCILIATION_UI=true` in the existing owned
`QA/support/auth-http-ui-server.ts` runner; it copies transitive worker sources
for compilation but disables workers and blocks external/paid network access.
Synthetic evidence/session tokens stay in the private fixture directory.
