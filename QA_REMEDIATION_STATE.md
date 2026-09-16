# QA_REMEDIATION_STATE

This root file is an entrypoint only. The **one canonical state file** is
[`reports/qa-remediation/QA_REMEDIATION_STATE.md`](reports/qa-remediation/QA_REMEDIATION_STATE.md).

Do not duplicate or independently edit state here. Append remediation statuses,
handoffs, and evidence only to the canonical nested state file. Its `Status`
field is authoritative and is limited to `OPEN`, `IN_PROGRESS`,
`FIXED_UNVERIFIED`, `VERIFIED_PASS`, and `BLOCKED_HUMAN`; `OUT_OF_SCOPE` is
only a classification for unsupported inventory rows.