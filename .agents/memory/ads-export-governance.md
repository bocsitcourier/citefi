---
name: Ads export governance
description: Durable integrity and product-boundary rules for campaign ad handoff exports.
---

Campaign Ads Lab is an export-only handoff surface. It must never imply direct platform publishing, media spend, policy approval, or guaranteed performance. Every handoff states: “Manual review and platform upload required.”

**Why:** Client-ready ad exports cross billing, tenant, policy, and external-destination trust boundaries. A mutable export or weak landing check can invalidate approvals and audits after the user believes the package is final.

**How to apply:** Use the campaign’s confirmed immutable Brand snapshot; require deterministic UTMs, landing and policy checks, explicit human acknowledgement, and role-gated export approval. Finalization freezes the whole export record. Build byte-stable ZIPs only from the finalized manifest, audit the artifact hash, pin safe-fetch connections to screened public DNS results, and retain successful-generation reservations until debit settles.