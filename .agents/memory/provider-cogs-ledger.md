---
name: Provider COGS ledger
description: Durable financial-accounting rules for provider usage, retries, attribution, and platform canaries.
---

Actual provider COGS must come only from an effective-dated locked rate snapshot. If no rate matches, retain the usage as explicitly unpriced with zero actual COGS; never promote a caller estimate into financial truth.

**Why:** Mutable estimates destroy historical reproducibility and can make unknown models look falsely profitable.

**How to apply:** Keep estimates in operational telemetry only. Margin and reconciliation views must distinguish unpriced usage from free usage.

Every physical paid-provider attempt must have validated tenant or explicit platform-cost ownership before submission. A successful provider response must not be returned if immutable accounting fails, and that accounting failure must not trigger another physical provider retry.

**Why:** Best-effort logging silently loses real spend; retrying an already-completed provider call can double cost and output.

**How to apply:** Use stable per-attempt identities, fail closed on ledger errors, preserve provider errors as causes, and scan direct SDK submission boundaries for adjacent centralized accounting.

Platform canaries need an explicitly configured internal accounting owner. They must not select an arbitrary customer workspace; without an owner, fail before provider submission.

**Why:** Canary spend is real platform COGS but must not contaminate a customer's profitability.

**How to apply:** Supply a positive `CANARY_ACCOUNTING_TEAM_ID` for the designated internal/platform workspace in each environment.

A priced ledger with zero unpriced rows does not prove that every paid call was recorded. Keep unresolved post-provider accounting failures separate from recorded totals; never invent a usage event to fill the gap.

**Why:** Successful provider responses and committed accounting writes can lose their acknowledgements. An error envelope alone does not establish exact usage or provider request identity.

**How to apply:** Reconcile physical submissions against receipts as well as ledger rows. Until missing receipts can be recovered, reserve a conservative bound using the provider's request limits and locked rates, and label the amount as exposure—not confirmed expense.

Receipt identity must distinguish a new logical generation from redelivery of
the same generation. Resource identity and logical invocation identity are
not interchangeable.

**Why:** A permanent resource key blocks intentional regeneration, while a new
random key on queue redelivery permits duplicate paid submissions. Neither
failure is detectable by testing ledger insertion alone.

**How to apply:** Preserve durable job/request/operation identity at the entry
boundary and allocate stage-specific call slots beneath it before throttling
or retrying. Test both intentional regeneration and crash/redelivery together.

Receipt recovery must never resubmit a provider request or infer missing usage.
Admission requires the primary store; an independent durable fallback is for
retaining returned evidence, not for permitting spending during a database outage.

**Why:** A ledger insert can commit and then report failure, and a provider can
return only partial usage. Replaying either operation without its original
identity risks duplicate charges or invented financial evidence.

**How to apply:** Reconcile by the original receipt identity, retain absent
counts as absent, and test both concurrent admission and committed-then-error
accounting. Keep actual provider usage distinct from request bounds. Future
receipt coverage does not reconstruct the historical unrecoverable call.