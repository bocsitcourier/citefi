# Approved security scan evidence



Scanners were invoked through the approved security-scan callbacks. This file intentionally excludes payloads, source excerpts, fingerprints, secret-like values, and full messages.



## dependency-audit
status: ok
total: 0
severity_counts: {}
metadata_vulnerabilities: {"critical":0,"high":0,"info":0,"low":0,"moderate":0}
finding_paths: none returned

## sast
status: ok
total: 0
severity_counts: {}
finding_paths: none returned

## hounddog
status: ok
total: 4
severity_counts: {"medium":1,"low":3}
finding_paths:
- lib/article-critique.ts
- lib/gemini.ts
- lib/gemini-social.ts
- scripts/setup-live-generation-fixture.ts
rule_ids_by_path:
- lib/article-critique.ts: LOW / BUDGET / privacy_violations=4
- lib/gemini.ts: MEDIUM / INCOME / privacy_violations=4
- lib/gemini-social.ts: LOW / PHYSICAL-ADDRESS / privacy_violations=3
- scripts/setup-live-generation-fixture.ts: LOW / EMAIL / privacy_violations=3
triage: scanner-only static findings; no payloads or full messages retained here. These paths are outside the owned Phase 2 auth/authz/CSRF/tenant/admin/upload implementation scope.
