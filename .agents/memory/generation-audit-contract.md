---
name: Generation audit and cost-safety contract
description: User-required acceptance standard for CiteFi generation audits and costly-media failure testing.
---

Generation audits must discover capabilities from the repository and follow each
pipeline from user input through provider execution, validation, persistence,
retrieval, playback, export, and publishing where actually supported. Startup,
HTTP success, queue acceptance, and a preview alone do not certify a pipeline.

**Why:** The user explicitly requires usable, retrievable assets and honest
end-to-end evidence rather than apparent frontend success.

**How to apply:** Maintain architecture, generation/provider matrices, failure
recovery, cost-control, testing, and provider-replacement documentation. Separate
code inspection, simulated-provider tests, integration tests, and live-provider
evidence; explicitly report unsupported features and untested steps. Apply
reproducible fixes and regression tests only when implementation is authorized;
an initial audit-only request requires findings before changes. Never label a
draft/export as a live external publication.

Cost leakage in image, video, and audio generation is a critical audit priority.
Test duplicate delivery, rapid repeated Generate clicks, retries after provider
success, failures during storage/accounting, cancellation, abandoned work,
worker crashes, and exhausted retries.

**Why:** The user specifically identifies expensive media amplification as more
financially dangerous than ordinary text-generation defects.

**How to apply:** Count physical provider submissions as well as credit debits.
Require bounded retries, durable operation identity/checkpoints, tenant-scoped
deduplication, protected settlement, and explicit treatment of ambiguous
provider outcomes. Simulated provider calls must be identified as such; they
prove failure behavior but not live provider or final-media compatibility.

Capture the selected model, request limits, and stable attempt identity before
every paid audit call, including auxiliary transcription or quality checks.
Budget reservations must cover all test workspaces and all helper calls.

**Why:** An auxiliary verification call lost its accounting details, leaving no
recoverable model or request bound. A small-looking ledger total could not prove
compliance with the user's absolute spending ceiling.

**How to apply:** Persist non-secret request metadata before submission and retain
receipts independently of ledger insertion. Do not describe an assumed model
limit as a confirmed bound for an unidentified call.

When an integration test fails a newer output gate, distinguish fixture drift
from a broken intermediate conversion before changing the fixture.

**Why:** During an audit, invalid fixture content initially obscured a real
format-conversion defect. Replacing it with valid input still failed the
downstream contract; changing that input to the downstream format would have
hidden the production failure.

**How to apply:** Keep fixtures faithful to the upstream provider contract,
then trace the actual transformation and persisted output. Preserve both input
and final-output validation rather than weakening a gate to make tests pass.

Exercise both accepted and rejected enhancement paths, including entity
integrity checks, when validating article structure.

**Why:** Returning the original text on an integrity failure concealed a
Markdown-destroying humanizer; articles only broke when the enhancement was
accepted. Passing examples therefore did not establish structural safety.

**How to apply:** Preserve Markdown blocks through prose transformations and
validate the rendered result. A valid pre-enhancement article can be retained
with an explicit warning when an optional enhancement breaks its structure;
invalid provider input must still fail validation.

Do not assume increasing a total output-token cap provides more space for
structured JSON when the model also spends that allowance on reasoning.

**Why:** Live QA consumed nearly the entire allowance on reasoning at two
different caps, leaving truncated JSON. Raising the cap alone did not produce
a usable response.

**How to apply:** Verify the selected model's supported reasoning controls,
record them alongside the total-output bound, and test serialized requests
offline before another paid attempt. Retain truncated responses and usage as
failed evidence rather than replaying a physically submitted attempt.

An accounted receipt and a correct native total do not by themselves prove
that the cost calculation includes every billed category.

**Why:** Live receipts retained reasoning usage, but cost classification priced
only visible output; receipt completeness concealed an understated cost.

**How to apply:** Compare billed-category quantities and locked-rate cost
calculations against native usage during live acceptance, including reasoning
and modality-specific output. Preserve original underpriced evidence when
fixing future accounting; do not silently rewrite historical costs.

## All-role future scenarios

Future-scenario hardening must cover team owners/admins, platform administrators,
regular users, and client reviewers—not only generation happy paths.

**Why:** The user explicitly requires the architect to consider future failures
for all users, including administrators.

**How to apply:** Include concurrent permission changes, credential recovery,
administrator financial adjustments, delivery/callback ordering, revocation,
and ambiguous work recovery. Distinguish confirmed defects from hypotheses and
source-contract checks from actual concurrent/runtime evidence.

The user's master QA contract distinguishes deployed Live, Sandbox, and Auto
execution. Missing credentials in Strict Live block that stage; Auto fallback
must remain visible and cannot turn a failed live stage into a live pass.

**Why:** The requested release audit explicitly separates working simulations
from verified real integrations and forbids silent fallback or inferred success.

**How to apply:** Record mode and evidence per stage, distinguish deployed
browser verification from isolated real-provider tests, and obtain explicit
destination/content approval before public test publication. During an initial
audit, preserve application code and live artifacts pending approval. Stop new
paid generation and publication at 80% of the configured application-credit
budget; track external API dollars separately.
