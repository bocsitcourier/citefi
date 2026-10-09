---
name: Media QA paid stop
description: Separate image approval does not authorize podcast/video; ambiguous paid media requires an owner reconciliation decision.
---

After an ambiguous paid-media QA response, retain the shared budget reservation
and lock. A separate image-only execution decision is not permission to proceed
to podcast/video, settle a failed application receipt, or retry the image.

**Why:** A native successful image response failed the QA guard, was classified
as a provider rejection by the application, and never reached COGS or storage.
Offline byte decoding and a reasoned usage estimate cannot make the original
application attempt successful.

**How to apply:** Read the current retained evidence and architect execution
decision before new paid work. Obtain explicit owner reconciliation/authorization
and a reviewed per-stage spending manifest. Distinguish native receipt valuation,
application settlement, actual retrieval/playback, and cloud certification.

Explicit owner-approved offline reconciliation may update the shared budget
from retained native usage and official rates, but must preserve the original
failed application outcome and receipts. It grants no permission for a new
physical provider submission or application rebilling.

**Why:** The owner approved evidence-only budget reconciliation separately
from paid execution; treating it as renewed paid permission would exceed scope.

**How to apply:** Retain a pre-change ledger and approval evidence, serialize
the budget update, release only the matching hold after durable settlement, and
keep any later paid run behind its own reviewed bounds and execution decision.

Do not assume a finite TTS character limit is a dollar ceiling for a model priced
by text-input and audio-output tokens.

**Why:** The speech request can lack an output-token cap and native token usage,
so character telemetry cannot prove either actual cost or a hard output bound.

**How to apply:** Establish a defensible enforced cost ceiling and billable-unit
receipt strategy before any paid TTS submission, including each segment and any
verification calls.

The owner selected a **TTS-1 preparation-only QA path**, with no production
default replacement and no default-model certification.

**Why:** Character-priced selected-model QA can be bounded without pretending
to prove the token-priced default TTS path. The owner approved preparing this
alternative, not paying for it; official documentation labels TTS-1 deprecated.

The owner declined authorization for any new paid QA. Preparing this alternative
does not authorize execution. Two historical paid QA calls remain unreconciled;
their reservations and uncertainty must not be treated as settled or free.

**How to apply:** Preserve the production default. Require fresh official
pricing and an independently approved bounded execution manifest before any
future paid run, plus separate explicit owner authorization; stop on rejection
without model fallback.

An application `provider_rejected` label does not prove zero provider spend
when the native acknowledgement was empty, unparsable or rejected by a QA guard.

**Why:** These failures can occur after a physical request, before the application
has captured an operation ID or usage. A parser exception is not a billing receipt.

**How to apply:** Preserve original outcomes and unknown-spend coverage. Require
native evidence or an explicit owner disposition before releasing financial holds;
do not infer free usage or regenerate merely from the application failure label.

Stage watchdogs must be consistent with the advertised per-request, polling
and download limits for the chosen concurrency, including processing and export.

**Why:** A bounded sequential clip plan can exceed its whole-stage deadline
even when every clip stays within its own limits. Premature termination then
creates incomplete paid work and retained uncertainty, not cheaper acceptance.

**How to apply:** Check worst-case deadline arithmetic before seeking paid
permission. If deliberately using a shorter stage deadline, define and enforce
the smaller per-clip allocations and partial-stage hold/export behavior. Do
not promise all per-clip maxima can fit a shorter stage budget.

Bounded multi-phase QA needs both pre-cleanup evidence and post-settlement
financial evidence retained independently for every phase.

**Why:** A pre-cleanup export can prove that receipts/assets were saved while
still showing a pending reservation. A later phase's final export cannot prove
the earlier phase's settlement or preserve its financial closure.

**How to apply:** Treat cleanup permission and financial closure as separate
audit facts. Preserve both before advancing phases or deleting owned fixtures;
never substitute a final phase's outcome for a missing earlier settlement.
