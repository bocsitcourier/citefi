---
name: Automatic model upgrade expectation
description: Product expectation distinguishes adopting new releases from availability fallback.
---
The user expects the system to automatically upgrade OpenAI and Gemini models as versions change, not merely continue using an older model until it disappears.

**Why:** The user explicitly challenged continued older-model selection and said automatic version upgrades were supposed to be part of the system.

**How to apply:** Evaluate upgrade behavior separately from model existence checks and missing-model fallback. Do not describe availability validation as automatic adoption of newer releases. When implementing this requirement, preserve existing pricing, spending, compatibility and paid-test authorization safeguards; a model being listed is not sufficient evidence that promotion is safe.

Automatic upgrades are intentionally bounded by behavior compatibility and economic equivalence. Unknown model families require certification rather than adoption based on their names.

**Why:** A newer model can reject the existing request parameters or add differently priced modalities; catalog availability alone proves neither a usable result nor an authorized cost.

**How to apply:** Treat discovery, compatibility approval, and pricing approval as separate decisions. Compare costs per modality, not an aggregate that can hide an increase. Keep blocked discoveries visible to administrators instead of calling them successful upgrades.
