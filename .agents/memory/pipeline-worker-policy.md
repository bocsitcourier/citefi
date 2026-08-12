---
name: Pipeline worker policy
description: Cross-cutting BullMQ worker policy (error taxonomy, credit release, budget gates) lives in one wrapper; rules and rationale.
---

# Pipeline worker policy — single registration point

All BullMQ workers must register through the shared `createPipelineWorker` wrapper (lint-enforced ban on direct `new Worker(`). The wrapper owns error classification, final-attempt-only credit release (never on "DEBIT_FAILED"), and fatal → UnrecoverableError.

**Why:** per-worker copies of this policy drifted — missing releases, whole-batch refunds for a single failed item, inconsistent fatal handling.

**Durable rules (not obvious from code):**
- `assertRunBudget` cost-ceiling gates belong INSIDE processors' try blocks, not the wrapper — BUDGET_EXCEEDED must flow through the processor catch for domain cleanup (status writes, batch completion, slot/temp-file cleanup) before wrapper policy fires.
- Run-context attribution and the budget gate must key off the SAME job-data field (creditRunId). A mismatch makes ceilings sum $0 forever — this shipped once as a real bug.
- Multi-item batch reservations require a partial-release `amount` + per-item `releaseKey`; an omitted amount releases the ENTIRE reservation.
- Processors that swallow errors (no rethrow) must settle billing themselves — the wrapper never sees swallowed errors.
- Test the pure handler with injected release deps; `--test-force-exit` needed because the pooled DB keeps node:test alive.
