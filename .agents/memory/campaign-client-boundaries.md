---
name: Campaign client boundaries
description: Rules for keeping multiple agency clients isolated within one team.
---

Campaign-associated deliverables must resolve Brand Intelligence from the campaign's immutable snapshot using both team and campaign identity. They must fail closed rather than falling back to the team's mutable live profile. Legacy work without a campaign may continue using the team profile during compatibility.

**Why:** One team can represent multiple agency clients. A single mutable team profile can be repointed while another campaign is generating, causing one client's brand context to be applied to another client's deliverable even though tenant authorization is technically valid.

**How to apply:** Derive campaign identity from the canonical database root (batch, article, social post, or video idea), thread it through every prompt/context/review path, and preserve completed research as a campaign candidate snapshot before the mutable profile can change.