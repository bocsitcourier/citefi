# Citefi Launch Certification Checklist

**Policy version:** `2026-08-22`  
**Decision authority:** `reports/blueprint-decision-register-2026-08-22.md`  
**Machine-readable gates:** `LAUNCH_GATES` in `lib/launch-governance.ts`

## Certification rule

The Release Owner may certify only the surface named in the certification. Google/Meta approval is **not** required for export-only certification; it is required for that platform’s direct publishing. A prose statement, passing smoke test, or platform approval cannot substitute for the evidence listed below.

## Blocking release gates

| Gate | Threshold | Owner | Current snapshot | Required evidence |
|---|---|---|---|---|
| Type safety | `npm run check` exits 0 | Engineering Owner | **FAIL** in August 22 QA | CI log from release commit |
| Production build | Build exits 0 with type errors enforced | Engineering Owner | Not certified | CI build artifact |
| Critical tests | Auth, admin isolation, billing, generation failure, restart recovery all green | Release Owner | Not certified | Named workflow logs |
| Tenant isolation | 0 unauthorized cross-tenant reads/writes | Security Owner | Not certified | Route inventory + regression suite |
| Admin isolation | Every admin route returns 401/403 for non-admin | Security Owner | Not certified | Automated route audit |
| Credit integrity | 0 reserve/debit/release/idempotency failures | Billing Owner | Partially verified | Billing + restart-safety suites |
| Reversible migrations | Dry run, forward, rollback, and data-integrity checks pass in staging | Data Migration Owner | Not certified | Timestamped staging report |
| Restore readiness | Successful production-like DB/media restore within 30 days | Operations Owner | Not certified | Restore report + checksums |
| Observability | Web, worker, queue, DB, disk, memory, provider, and error alerts exercised | Operations Owner | Not certified | Alert test report + recipients |
| Documentation | Runbook, rollback, owners, and evidence links complete | Release Owner | Partial | Signed release record |

## Export-only Ads gates

| Gate | Threshold | Owner | Current snapshot | Required evidence |
|---|---|---|---|---|
| Google RSA package | 0 contract/format/ZIP failures | Ads Product Owner | Not built | Green export suite + sample |
| Meta creative pack | 0 contract/format/ZIP failures | Ads Product Owner | Not built | Green export suite + sample |
| UTM validation | 100% conform to locked convention | Marketing Operations Owner | Policy locked; builder not built | Export manifest test |
| Landing URL | HTTPS, reachable, preserved query params | Ads Product Owner | Not built | Alignment result in manifest |
| Policy/disclaimer | 0 unresolved required checks | Product/Compliance Owner | Policy locked; enforcement not built | Policy result + source snapshot |
| Human approval | Client + policy + agency export approval recorded | Agency Product Owner | Article approval only | Immutable approval audit record |
| Manual-upload notice | Present in 100% of packages | Ads Product Owner | Not built | Contract assertion |

Passing these gates certifies export only. It does not certify API publishing.

## Direct-publishing-only gates

| Platform | Threshold | Owner | Current snapshot |
|---|---|---|---|
| Google Ads | Developer token approved at required level, scopes verified, staging lifecycle green | Platform Integrations Owner | **NOT STARTED / DISABLED** |
| Meta Ads | Business Verification + App Review + Advanced Access approved, scopes verified, staging lifecycle green | Platform Integrations Owner | **NOT STARTED / DISABLED** |

## First-90-day operating scorecard

These targets measure whether the locked business assumptions are working. They do not waive safety gates.

| Metric | Formula/window | Target | Owner |
|---|---|---:|---|
| Active campaigns per active workspace | Campaigns exported or published / active workspaces, monthly | ≥ 1.0 | Product Owner |
| Brand Intelligence activation | New workspaces completing a verified scan within 24h / new workspaces, monthly | > 60% | Onboarding Owner |
| Time to first approved asset | p50 signup-to-first-approved-asset, weekly cohort | < 10 min | Product Owner |
| Week-1 campaign activation | New workspaces exporting/publishing a campaign within 7 days / new workspaces | > 40% | Growth Owner |
| Growth+ ad connection | Growth+ workspaces with at least one eligible analytics/ad connection / active Growth+ | > 50% | Integrations Owner |
| Month-3 logo retention | Workspaces active in month 3 / eligible paid cohort | > 70% | Growth Owner |
| Agency client adoption | Active client workspaces per active Agency workspace, monthly | ≥ 5 and non-declining | Agency Product Owner |
| Gross margin per credit | `(recognized credit revenue - reconciled provider cost) / recognized credit revenue`, trailing 30 days | ≥ 75% | Finance Owner |
| Negative-margin workspaces | Active workspaces below 0% margin / active workspaces, trailing 30 days | < 2% | Finance Owner |
| Approval without edit | Client-approved assets with no requested edit / reviewed assets, monthly | > 70% | Content Quality Owner |
| Daily Brief open rate | Unique opened briefs / delivered briefs, monthly | > 50% | Daily Brief Owner |
| Focus action rate | Focus actions completed / opened briefs, monthly | > 25% | Daily Brief Owner |
| Monthly scorecard view | Active paid workspaces viewing scorecard / active paid workspaces | > 40% | Analytics Owner |
| Growth+ CLV:CAC coverage | Growth+ workspaces with computable CLV and CAC / active Growth+ | > 60% | Analytics Owner |
| Generation job success | Successful terminal jobs / all terminal jobs, rolling 7 days, excluding user cancellation | ≥ 98% | Platform Owner |
| Standard first-asset latency | p95 enqueue-to-first-asset for non-video generation, rolling 7 days | ≤ 10 min | Platform Owner |

## Certification record template

```text
Release commit:
Environment:
Certified surface: core | ads-export | google-direct-publish | meta-direct-publish
Certification UTC:
Release Owner:
Failed/waived gates: (waivers are not permitted for security, billing integrity, or external approval)
Evidence bundle:
Rollback checkpoint:
Decision policy version:
```

## Current defensible claim

Until every gate for the named surface passes, the defensible status remains:

> Advanced beta / conditional launch candidate. Not certified as blueprint-complete or production launch-ready.