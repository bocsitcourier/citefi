---
name: Publishing reconciliation safety
description: Trust boundaries for proving receiver outcomes and authorizing a separate replacement without releasing paid holds.
---

An unknown publishing outcome is not permission to resend. A negative proof
must be receiver-native, signed against the original attempt and destination,
final, and backed by an irrevocable per-operation receiver fence. Missing posts,
negative callbacks, HTTP errors, or an empty new receiver filesystem are not
negative proof. Old unbound records remain fenced even if attempt timestamps
are missing.

**Why:** A receiver may have accepted a request before the engine lost its reply.
Treating absence as proof, or resetting the engine job, can create duplicate posts.

**How to apply:** Accepted proof resolves the original; proven non-acceptance
permits only a separately authorized new operation with current approval and
preserved links. The receiver claim/receipt ledger must survive restart,
restoration, and host replacement, and all replicas need the same durable CAS
store. Never reclaim an unknown claim to make recovery appear successful.

Publishing delivery reconciliation never settles historical paid-generation
records or releases their financial holds.

**Why:** Delivery acceptance and paid-provider accounting are separate evidence
contracts; this project's publishing scope explicitly excludes that authority.

**How to apply:** Use offline/owned fixtures by default. Require separate explicit
authorization for a live receiver read; do not couple publishing decisions to
provider settlement or reservation release.
