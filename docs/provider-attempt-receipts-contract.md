# Provider attempt receipt contract

Task #179 wrappers must put each physical paid SDK submission behind the
receipt core:

```ts
import {
  runWithProviderAttempt,
  type ProviderAttemptHandle,
  type ProviderAttemptContext,
  type SafeProviderRequest,
} from "@/lib/provider-attempt-receipts";

const context: ProviderAttemptContext = {
  teamId,
  campaignId,
  resourceType: "article",
  resourceId: articleId,
  operationType: "article_generation",
  provider: "gemini", // or "openai"/"brave"
  model,
  invocationKey: stableRunOrRequestKey,
  attemptKey: "generate-article",
};

const request: SafeProviderRequest = {
  model,
  maxInputTokens,
  maxOutputTokens,
  timeoutMs,
  adapterVersion,
};

const response = await runWithProviderAttempt({
  context,
  request,
  submit: async ({ captureResponse }: ProviderAttemptHandle) => {
    const result = await sdkCall();
    await captureResponse({
      providerRequestId: result.requestId,
      usage: {
        unitType: "tokens",
        inputUnits: result.usage.promptTokens,
        outputUnits: result.usage.completionTokens,
        unitCount: result.usage.totalTokens,
        known: true,
      },
    });
    return result;
  },
});
```

The callback receives no prompt or customer-content field.  The core validates
team/campaign/resource ownership before writing the prepared receipt and
before invoking `submit`.  It stores bounded model/limit metadata, probes the
configured fallback spool, then marks the attempt submitted before the SDK
call.  If fallback persistence is unavailable, the paid call is refused.  A
successful response must provide
known provider-returned usage; missing usage is terminal and is never replaced
by zero.

Production must configure one shared durable fallback for every worker:
either the private object-spool adapter or
`PROVIDER_ATTEMPT_RECEIPT_SPOOL_DIR` as the same absolute, durable path
visible to all workers.  The file adapter creates a 0700 directory and
0600 receipt files and refuses admission when this path is absent or not
writable; when the path is absent, the core lazily selects the shared private
DO Spaces object adapter.  If DO Spaces is not configured or reachable, its
`ensureReady()` fails closed before any paid call; there is no implicit
process-local or temporary fallback.

Adapters that already call `logCostTelemetry` can omit an explicit
`captureResponse`: while inside `runWithProviderAttempt`, cost telemetry uses
the `AsyncLocalStorage` receipt correlation and captures the normalized usage
before inserting the ledger event.  SDK-specific interceptors can instead call
`captureProviderSdkResponse(...)` from the same async scope.

Response capture is independent of the immutable `provider_usage_ledger`
insert.  If its primary database update fails, the core writes only the safe
receipt metadata to the explicitly configured
`PROVIDER_ATTEMPT_RECEIPT_SPOOL_DIR` (0600 files).  Reconciliation reads the
known response usage from the receipt/spool and inserts its deterministic
`sourceEventId` idempotently; it never calls the provider, polls an unknown
operation, or invents usage.

An existing receipt with a submitted, captured, uncertain, accounting-failed,
or accounted status is terminal for automatic replay.  Retry owners must call
`reconcileProviderAttempt({ sourceEventId })` after the provider-returned usage
has been durably captured.

## Logical invocation identity

Queue workers establish a receipt scope from the queue and durable job ID,
not the delivery count. Authenticated HTTP callbacks scope a supplied
`x-idempotency-key` to the authenticated owner, method, and path. An HTTP request
without that header is a new direct action, not an idempotent retry. Stronger
durable operation identities, such as direct-image reservation run IDs, take
precedence inside those operations.

Adapters allocate a deterministic call slot before entering rate limiters or
retry loops. They reuse its `invocationKey` and stage `attemptKey` while the
physical attempt number changes only for an explicitly permitted retry.
Intentional regenerations need distinct logical invocation keys; a resource ID
alone is not an invocation key. Redelivery of one job or keyed HTTP action
reuses its receipt identity and cannot resubmit an already-submitted call.
Standalone calls without a replayable scope receive a fresh invocation ID.
Rate-limiter callbacks retain the submitting invocation and tenant contexts.

## Operator recovery

Apply the registered versioned migration before enabling generation. The
normal post-merge migration runner includes the receipt table and tenant
policies. Verify the selected database target before applying migrations or
performing reconciliation.

For a known receipt and its owning team, run:

```sh
WORKER_PROCESS=true node --env-file=.env.local --import tsx/esm \
  scripts/reconcile-provider-attempt.ts TEAM_ID provider-attempt:ID
```

This command runs in a tenant-scoped worker context and prints only the
receipt identity, owner, and status. Re-running it is safe: the same receipt
uses the same immutable ledger source event. Missing usage is not repairable
by this command; retain that evidence for investigation instead of generating
a replacement request.

The default independent fallback uses the existing DO Spaces configuration
and private receipt objects shared across workers. Readiness is checked
before submission. If `PROVIDER_ATTEMPT_RECEIPT_SPOOL_DIR` is explicitly set,
it overrides that default and must point to an operator-provisioned persistent
filesystem shared by workers and the reconciler—not a temporary or ephemeral
directory. Restrict access to the worker account and include it in protected
backups. If neither fallback is ready, paid submission is blocked. A spool is
not an alternate admission gate when the database is unavailable.

## Historical limitation

These receipts protect future calls. They do **not** reconstruct the already
unrecoverable transcription call documented in
`reports/live-generation/assets/podcast-2238-transcription-v1-forensics.json`.
Its unknown model, request bounds, identity, and exact usage remain unknown;
the historical exposure must not be relabeled as confirmed expense.
