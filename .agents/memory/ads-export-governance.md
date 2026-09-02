---
name: Ads export governance
description: Durable integrity and product-boundary rules for campaign ad handoff exports.
---

Campaign Ads Lab is an export-only handoff surface. It must never imply direct platform publishing, media spend, policy approval, or guaranteed performance. Every handoff states: “Manual review and platform upload required.”

**Why:** Client-ready ad exports cross billing, tenant, policy, and external-destination trust boundaries. A mutable export or weak landing check can invalidate approvals and audits after the user believes the package is final.

**How to apply:** Use the campaign’s confirmed immutable Brand snapshot; require deterministic UTMs, landing and policy checks, explicit human acknowledgement, and role-gated export approval. Finalization freezes the whole export record. Build byte-stable ZIPs only from the finalized manifest, audit the artifact hash, pin safe-fetch connections to screened public DNS results, and retain successful-generation reservations until debit settles.

Cross-tenant client approval must validate the client workspace as active and non-deleted at three boundaries: reviewer authentication, the narrow agency-campaign relationship lookup, and again inside the row-locked approval transaction.

**Why:** Authentication and relationship state can change between checks. Omitting any boundary can let a former designated approver on a suspended or deleted client workspace create an approval that contributes to export authorization.

**How to apply:** Permit the client-reviewer role only through a relationship-scoped resolver, derive the agency tenant from the campaign rather than client input, and re-check client state while holding the same serialization lock used for separation-of-duties enforcement.