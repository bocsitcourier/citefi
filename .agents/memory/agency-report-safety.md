---
name: Agency report safety
description: Durable isolation, snapshot-consistency, and email-delivery rules for white-label client reports.
---

Client-readable report rows must physically contain only recursively sanitized client-safe snapshots. Put provider costs, credits, markup, revenue, and margin in a separate agency-only relation.

**Why:** PostgreSQL row-level security controls rows, not selected columns. A client-readable row cannot safely carry an agency-only financial JSON column, even if application projections usually omit it.

**How to apply:** Any future client-report field must be classified before storage. Financial or operational fields belong only in an agency-only table with separate grants and RLS; client routes must never join that table.

Generate immutable client and financial snapshots from one shared evidence result, with the approved configuration locked through commit.

**Why:** Independent reads can mix ledger/config states when usage is appended or configuration changes concurrently.

**How to apply:** Report creation uses READ COMMITTED with an exact agency/client/period transaction advisory lock, a share-locked approved config, one SQL evidence aggregation, and atomic client/financial inserts. Retry only serialization/deadlock failures.

Do not switch this report-creation transaction to REPEATABLE READ or SERIALIZABLE without redesigning when its snapshot is acquired.

**Why:** Reads before a blocking advisory lock establish a stale transaction snapshot at those isolation levels. A waiter can miss the committed winning report while the unique index sees it; bounded retries exhausted in the real eight-request regression. READ COMMITTED lets the post-lock existence check see the winner.

**How to apply:** Preserve the single-statement evidence snapshot and locked configuration that make READ COMMITTED safe here. If evidence collection becomes multiple independent statements, redesign consistency explicitly rather than copying this isolation choice.

Commit an append-only pending email claim before calling the provider. If provider acceptance is followed by an unavailable terminal audit write, leave the claim unresolved and do not resend automatically.

**Why:** Without a durable pre-send claim, a successful provider call followed by a database failure produces an untracked duplicate on retry.

**How to apply:** Failed attempts with a recorded terminal state may retry; successful or unresolved attempts must suppress duplicate sends unless a future provider offers a true idempotency key.

Agency parents must never gain raw SELECT access to client content or credit-ledger rows just to build reports. Expose only a direct-child-authorized, fixed-search-path database function that returns the approved aggregate evidence shape.

**Why:** Ordinary tenant RLS correctly hides child-owned rows from the parent agency, while broad parent policies would also expose prompts, content bodies, and low-level financial events that reports do not need.

**How to apply:** Keep report aggregation behind a narrow SECURITY DEFINER function that validates the web agency admin and active direct-child relationship before disabling row security. Return counts/sums and explicitly approved brief evidence only, and integration-test both populated aggregates and denial of raw parent reads.

When declarative schema push runs before a security migration, the schema must already declare every unique target needed by its foreign keys, and the migration must idempotently retrofit checks and composite FKs onto pre-created tables.

**Why:** `CREATE TABLE IF NOT EXISTS` cannot add constraints to a table that schema push created first, and a composite FK cannot be created before its matching unique target exists.

**How to apply:** Keep shared schema and SQL migration uniqueness aligned; add named constraints conditionally in the migration and exercise the real post-merge ordering.