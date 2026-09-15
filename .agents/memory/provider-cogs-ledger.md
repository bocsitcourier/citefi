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

**Why:** Live execution exposed a successful provider response rejected during ownership validation before any immutable usage row existed. The remaining error envelope did not retain the exact usage or request identity.

**How to apply:** Reconcile physical submissions against receipts as well as ledger rows. Until missing receipts can be recovered, reserve a conservative bound using the provider's request limits and locked rates, and label the amount as exposure—not confirmed expense.