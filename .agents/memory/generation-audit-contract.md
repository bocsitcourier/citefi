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