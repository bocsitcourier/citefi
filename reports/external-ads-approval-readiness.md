# Google Ads and Meta Approval Readiness

**Status date:** August 22, 2026  
**Product fallback:** Export-only; third-party approval is not an export-launch blocker.  
**Status source:** `EXTERNAL_PLATFORM_APPROVALS` in `lib/launch-governance.ts`

No credentials, tokens, legal documents, or private identifiers belong in this repository. This tracker records evidence names and status only; private evidence stays in the company-controlled document store.

## Accountability

| Responsibility | Named owner role |
|---|---|
| Prepare applications, scopes, walkthroughs, and test evidence | Platform Integrations Owner |
| Own the legal business identity and platform accounts | Company Account Owner |
| Validate privacy, deletion, terms, and ad-policy claims | Product/Compliance Owner |
| Approve enabling any direct-publish feature flag | Release Owner |

## Status tracker

| Platform | Current status | Submitted | Decision | Direct publish | Non-blocking fallback |
|---|---|---|---|---|---|
| Google Ads | **NOT STARTED** | — | — | Disabled | Google RSA export |
| Meta Ads | **NOT STARTED** | — | — | Disabled | Meta creative pack export |

Allowed statuses are `not_started`, `evidence_ready`, `submitted`, `changes_requested`, `approved`, and `rejected`. A status change must include the platform submission ID, UTC timestamp, evidence-store reference, and reviewer.

## Shared submission evidence

- [ ] Production product name, domain, privacy policy, terms, and support contact are final.
- [ ] Data-flow diagram identifies every requested permission and stored field.
- [ ] Data retention and deletion process is documented and demonstrated.
- [ ] OAuth consent is initiated by the user and can be revoked.
- [ ] Tokens are encrypted, tenant-scoped, never exposed to the browser, and re-auth errors have a remedy.
- [ ] A test agency and test client demonstrate account selection and tenant isolation.
- [ ] A 2–3 minute walkthrough demonstrates campaign creation, human approval, export, and the direct-publish feature remaining disabled.
- [ ] Export packages contain policy result, UTM values, landing URL, approvers, timestamp, and “Manual review and platform upload required.”
- [ ] No screen or document claims approval before the platform decision is recorded.

## Google Ads application package

**Target:** Developer token at Basic access or higher through a Google Ads Manager Account.

- [ ] Company Account Owner creates/confirms the Manager Account and records the manager customer ID privately.
- [ ] Platform Integrations Owner writes the developer-token application answers: business model, customers, tool purpose, data usage, account management, and support process.
- [ ] OAuth consent screen lists only the production scopes required for the demonstrated flow.
- [ ] Privacy policy and terms explicitly cover Google Ads data handling and deletion.
- [ ] Walkthrough shows user-clicked consent, account selection, campaign draft, RSA export, policy warnings, and disconnect/delete.
- [ ] A valid RSA sample includes supported headline/description counts and a UTM-tagged HTTPS final URL.
- [ ] Test evidence proves no direct API call occurs when status is not `approved`.
- [ ] Submission ID and UTC timestamp are added to the tracker.
- [ ] Any reviewer questions and response evidence are attached.
- [ ] Approval level/scopes are independently verified before the direct-publish feature flag can be considered.

## Meta application package

**Target:** Business Verification, App Review, and Advanced Access for every permission required to manage customer ad accounts.

- [ ] Company Account Owner creates/confirms the Business Manager and records the business ID privately.
- [ ] Business Verification documents and legal identity are current and consistent with the production domain.
- [ ] Each requested permission has a plain-language necessity statement and exact screen recording.
- [ ] Privacy policy, data deletion callback/instructions, terms, and support contact are live.
- [ ] Walkthrough shows user-clicked consent, business/ad-account selection, campaign draft, creative pack export, policy warnings, and disconnect/delete.
- [ ] A valid creative-pack sample includes copy, asset manifest, placements/aspect ratios, disclaimer result, and UTM-tagged HTTPS destination.
- [ ] Test evidence proves no direct API call occurs when status is not `approved`.
- [ ] Submission ID and UTC timestamp are added to the tracker.
- [ ] Reviewer changes and resubmission evidence are attached.
- [ ] Business Verification, App Review, and Advanced Access are each independently verified before direct publishing can be considered.

## Direct-publishing release rule

Approval alone is insufficient. Direct publishing for a platform remains disabled until all of the following are true:

1. the platform status is `approved`;
2. production scopes exactly match approved scopes;
3. tenant-isolation and token-security suites are green;
4. create/update/pause/error/re-auth flows pass in production-like staging;
5. policy, disclaimer, landing URL, approval, and audit records are mandatory;
6. the Release Owner signs a dated direct-publishing certification.

Failure or delay at any step leaves export-only behavior intact.