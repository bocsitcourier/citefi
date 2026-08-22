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
- Processor catches must rethrow after domain cleanup; never swallow provider errors or release reservations in-processor. Domain status/notifications must remain non-terminal for every disposition that worker actually retries; do not retry fallback/degrade without an implemented alternate strategy.
- Once content is durable, a debit failure must be a structured `BillingSettlementError` and retries must resume from a durable settlement-only checkpoint. Never regenerate delivered content or release its reservation.
- A retryable classification only helps when enqueue options provide `attempts > 1` and backoff. Verify both the processor rethrow and the queue's retry budget whenever adding a transient error path.
- Test the pure handler with injected release deps rather than spinning up Redis/Workers.
