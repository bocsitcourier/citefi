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
evidence; explicitly report unsupported features and untested steps. Fix safely
reproducible defects and add regression tests. Never label a draft/export as a
live external publication.

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