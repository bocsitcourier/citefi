# Citefi Blueprint Decision Register

**Locked:** August 22, 2026  
**Policy version:** `2026-08-22`  
**Machine-readable defaults:** `lib/launch-governance.ts`  
**Commercial sources of truth:** `lib/billing/plans.ts`, `lib/credit-menu.ts`  
**External approval tracker:** `reports/external-ads-approval-readiness.md`  
**Release criteria:** `reports/launch-certification-checklist.md`

## Purpose

This register closes every recommendation, assumption, and open question in the consolidated Citefi blueprint. It is a decision record, not a claim that deferred product work is complete. Engineering must not replace these defaults with a different interpretation without updating this register, its owner, and the policy version.

## Disposition vocabulary

| Disposition | Meaning |
|---|---|
| **Already delivered** | The behavior exists in the current product and has code evidence. Final launch still requires the applicable QA gate. |
| **Build now** | This decision is locked by the governance/configuration work in this register. Product enforcement may be separately deferred where stated. |
| **External dependency** | A third party or human-owned account must act. The export-only product must continue without it. |
| **Intentionally rejected** | The blueprint recommendation will not be used for this launch. |
| **Deferred** | The decision is made, but implementation or proof belongs to the named owner for the stated reason. |

## Locked commercial defaults

The blueprint’s $79–$799 plan examples and cost-per-credit examples were explicitly illustrative. They are **rejected for launch** in favor of the existing runtime catalog:

| Plan | Monthly price | Included credits | Seat cap | Client workspace cap | Launch treatment |
|---|---:|---:|---:|---:|---|
| Free | $0 | 30 one-time | 1 | 0 | One verified organization, no card, no credit refresh |
| Starter | $29 | 50/month | 3 | 0 | Self-serve |
| Growth | $89 | 200/month | 10 | 0 | Self-serve |
| Agency | $249 | 1,000/month | 25 | 25 | Self-serve; separate client balances |
| Enterprise | $999 | 5,000/month | Unlimited | Unlimited | Sales-assisted |

- Annual billing charges exactly **10 monthly prices for 12 months of service**.
- Top-ups are $5/10 credits, $10/20, and $25/50. Purchased credits do not expire.
- Monthly allowance is consumed before purchased credits. Failed generation releases its reservation.
- There is no automatic metered overage. The remedy is a top-up or plan change.
- The launch credit menu is the full `CREDIT_MENU` in `lib/credit-menu.ts`; team/global administrative overrides take precedence and must remain auditable.
- Free is limited to one verified organization, one seat, 30 one-time credits, watermarked media, and no direct ad/social publishing. Enforcement that does not already exist is deferred to the owning product surfaces and cannot be marketed as delivered.
- Agency client workspaces keep separate balances. Citefi does **not** pool credits, calculate markup, invoice agency clients, or expose provider cost/margin to clients at launch. The agency owns external rebilling.
- The blueprint’s separate Veo-credit bucket is rejected for launch. Veo remains on unified credits with hard run ceilings until provider-cost accounting supplies enough measured evidence to reconsider.

## Locked economics and provider-cost policy

- Minimum trailing-30-day gross margin per credit: **75%**.
- Maximum share of active workspaces with negative trailing-30-day gross margin: **under 2%**.
- Prices and ceilings must be evaluated against **p90**, not mean, successful provider cost with at least **100 successful samples per operation**.
- Primary cost evidence is recorded provider usage valued at the rate card effective when the call occurred.
- Monthly provider invoice/billing exports are the reconciliation source.
- Failed provider calls retain their actual cost even when customer credits are returned.
- An unknown model or a zero-priced model event blocks margin certification; it must never be interpreted as free.
- Rate-card, model, prompt/pipeline, and material p90 cost changes trigger remeasurement.
- Current per-run ceilings are temporary safety caps, not proof of margin.

## Locked product and policy defaults

### Product model

- External category: **Local Marketing Campaign Engine**.
- Promise: **Create complete local marketing campaigns from one business URL.**
- `Campaign` is the lifecycle parent. `Batch` remains the generation-run term during migration and must not become a second campaign concept.
- Product lifecycle: `DRAFT → INTERNAL_REVIEW → CLIENT_APPROVED → EXPORT_READY → EXPORTED`.
- Export-only is the launch mode. Direct ad publishing is disabled until platform approval and direct-publish certification both pass.

### Reports and ownership

- The agency workspace owns the report record and brand configuration.
- The designated client approver owns client content approval.
- Default recipients are the agency account owner and the designated client approver.
- The agency account owner owns final send/export approval.
- Delivery is never automatic by default.
- Client copies exclude provider costs, credit margin, agency markup, and internal prompts.

### UTM convention

- Values are lowercase ASCII kebab-case.
- HTTPS landing page is required; existing non-UTM query parameters are preserved.
- Existing UTMs are never overwritten without explicit approval.
- Google Ads: `utm_source=google`, `utm_medium=cpc`.
- Meta Ads: `utm_source=meta`, `utm_medium=paid_social`.
- `utm_campaign={campaign-slug}`.
- `utm_content={asset-slug}--{variant-slug}`.
- `utm_term={keyword}` only where a keyword exists.

### Advertising and disclaimers

- Human approval is required for every ad export.
- Agency workspace owner authorizes export; Product/Compliance owns policy approval.
- Required disclaimers come from the workspace Brand Intelligence policy pack.
- A regulated vertical without review, or an unresolved required disclaimer, blocks export.
- Every export states: **“Manual review and platform upload required.”**
- AI must not recreate exact logos, trademarked text, or protected brand assets. It may generate the scene and composite a user-uploaded approved asset after preview approval.

## Blueprint closure matrix

| ID | Blueprint item | Disposition | Locked decision, owner, and evidence/reason |
|---|---|---|---|
| STR-01 | Own local campaign execution, not generic AI writing | Build now | **Product owner.** “Local Marketing Campaign Engine” is canonical; this register and `PRODUCT_POLICY_DEFAULTS` are the evidence. |
| STR-02 | Campaign as the parent object | Deferred | **Campaign product owner.** Campaign is canonical; Batch remains a generation run until the campaign migration is delivered. |
| STR-03 | URL → discover → plan → create → review → export/report workflow | Deferred | **Campaign product owner.** Locked workflow, but implementation belongs to “Unify every client deliverable into campaigns.” |
| STR-04 | Brand Intelligence as first-run source of truth | Already delivered | **AI product owner.** Brand profiles and generator context exist; final cross-pipeline coverage remains separately tracked. |
| STR-05 | Fewer than seven workflow-led navigation items | Deferred | **Product design owner.** Wait for the Campaign parent so navigation does not encode another temporary model. |
| STR-06 | Homepage URL-to-campaign claim and audit CTA | Deferred | **Growth product owner.** Do not claim a one-URL campaign until the Campaign workflow and acceptance test exist. |
| STR-07 | Agency/client visibility boundaries | Already delivered | **Agency product owner.** Agency/client team roles and client review surfaces exist; tenant-isolation certification remains blocking. |
| STR-08 | White-label monthly reports | Deferred | **Reporting owner.** Ownership/recipient policy is locked here; implementation belongs to the downstream report/rebilling work. |
| STR-09 | Continue using the Citefi name despite Citefy similarity | Deferred | **Company/legal owner.** Continue provisionally; trademark/domain clearance is required before GA marketing spend. |
| SEC-01 | HttpOnly cookie auth; no response-body/browser tokens | Deferred | **Authentication owner.** Policy accepted; legacy browser-token removal must pass its existing regression work before launch. |
| SEC-02 | Public basic health; detailed admin health | Deferred | **Operations owner.** Required before GA; proof is an unauthenticated data-exposure test plus admin-only deep health test. |
| SEC-03 | Every admin route uses admin authorization | Deferred | **Security owner.** Required; final evidence is a route inventory and green non-admin 401/403 regression suite. |
| SEC-04 | PostgreSQL RLS or equivalent tenant isolation | Deferred | **Security owner.** Default-deny, tested isolation is mandatory; implementation is owned by the tenant-isolation task. |
| SEC-05 | Team versus workspace vocabulary | Build now | **Product/architecture owner.** `team` remains the database tenant; `workspace` is the product term; Campaign references the team ID. |
| SEC-06 | OAuth token encryption, rotation, and tenant scope | Deferred | **Platform security owner.** Required before new production connections; secrets never enter reports or client exports. |
| SEC-07 | PII inventory, DPA, subprocessors, retention | External dependency | **Company/legal owner.** Legal artifacts and retention schedule are required before enterprise/agency contractual claims. |
| SEC-08 | China-hosted DeepSeek processing of client data | Intentionally rejected | **AI security owner.** Only Western-hosted or self-hosted open weights may process client data. |
| SEC-09 | AI disclosure, crawler compliance, SPF/DKIM/DMARC | Deferred | **Compliance/operations owner.** Required per channel before the corresponding outbound feature is certified. |
| DATA-01 | Campaign-centric schema and child assets | Deferred | **Campaign engineering owner.** Additive schema first; no destructive rewrite. |
| DATA-02 | Metric snapshots instead of live provider dashboards | Deferred | **Analytics owner.** Dashboards must read durable snapshots once the campaign reporting layer is built. |
| DATA-03 | Provider usage events separate from credit ledger | Deferred | **Finance engineering owner.** Separation is mandatory; implementation belongs to provider-margin accounting. |
| DATA-04 | Idempotent campaign backfill, dual read, reversible rollback | Deferred | **Data migration owner.** Staging dry run and snapshot are mandatory before production migration. |
| DATA-05 | Reserve/reconcile lifecycle | Already delivered | **Billing owner.** Reservation → debit/release and idempotency exist; the release suite remains a launch gate. |
| ARCH-01 | Queue technology | Build now | **Platform owner.** BullMQ/Redis is canonical for new generation workers; pg-boss is legacy compatibility until migrated. Do not revert merely to match the blueprint. |
| ARCH-02 | Shared generation policy/quality middleware | Already delivered | **AI platform owner.** Shared pipeline classification/billing and quality layers exist; new generators must use them. |
| OPS-01 | Dev, staging, production environments | Deferred | **Operations owner.** Staging is mandatory before migration or GA certification. |
| OPS-02 | Separate web and worker processes | Already delivered | **Platform owner.** Separate runtime entry points exist; production restart/recovery proof is still required. |
| OPS-03 | DigitalOcean deployment architecture | Already delivered | **Operations owner.** DO deployment scripts/runbooks exist; infrastructure certification still checks capacity and TLS. |
| OPS-04 | Tagged CI deploy with type/test/build gates | Deferred | **Release engineering owner.** No release may bypass the launch checklist. |
| OPS-05 | Tested database/media restore | Deferred | **Operations owner.** A timestamped production-like restore within 30 days is blocking. |
| OPS-06 | Sentry/uptime/queue/disk/memory alerts | Deferred | **Operations owner.** All alert routes and recipients must be exercised before GA. |
| OPS-07 | Single-droplet Agency SLA | Intentionally rejected | **Operations owner.** No SLA claim until redundant production architecture and recovery evidence exist. |
| EXT-01 | Google Ads developer-token approval | External dependency | **Platform integrations owner; company account owner accountable.** Status starts `not_started`; export remains available. |
| EXT-02 | Meta Business Verification/App Review/Advanced Access | External dependency | **Platform integrations owner; company account owner accountable.** Status starts `not_started`; export remains available. |
| EXT-03 | GBP, GSC, GA4, keyword-provider enablement | External dependency | **Platform integrations owner.** Each connector requires its own scopes, account eligibility, and evidence before claims. |
| EXT-04 | User-clicked OAuth and recoverable connection states | Already delivered | **Platform integrations owner.** OAuth states/connections exist; each new provider must pass re-auth/error-remedy tests. |
| ADS-01 | Google RSA/Meta pack/UTM/policy export MVP | Deferred | **Ads product owner.** Locked as launch scope; implementation belongs to “Let agencies export complete ad campaigns.” |
| ADS-02 | Direct Google/Meta publishing at export launch | Intentionally rejected | **Release owner.** Disabled until platform approval and direct-publish gates pass. |
| ADS-03 | UTM convention | Build now | **Marketing operations owner.** Exact values are locked in this register and `PRODUCT_POLICY_DEFAULTS`. |
| ADS-04 | Ad disclaimer and regulated-vertical rule | Build now | **Product/Compliance owner.** Missing required policy data blocks export; enforcement ships with Ads export. |
| ADS-05 | Landing-page alignment and policy pre-check | Deferred | **Ads product owner.** Required in every export manifest; implementation belongs to Ads export work. |
| ADS-06 | Export approval ownership | Build now | **Agency workspace owner.** Client approval and policy approval are prerequisites; agency owner authorizes final export. |
| AI-01 | Task-specific model routing | Already delivered | **AI platform owner.** Model resolver and tiered routing exist; live model validation remains required. |
| AI-02 | Stitched video is default; Veo is premium/gated | Build now | **Video product owner.** Stitched output is default; Veo is queued, capped, never unlimited, and uses fallback where valid. |
| AI-03 | Veo retry/fairness/refund behavior | Already delivered | **Video platform owner.** Shared retry and reservation cleanup exist; live delayed-retry proof remains separately tracked. |
| AI-04 | Final production/preview provider and media inputs | Deferred | **Video product owner.** Decide only after measured cost/quality evidence; no “unlimited video” promise. |
| AI-05 | Exact-logo generation | Intentionally rejected | **Brand/Compliance owner.** Composite approved real assets instead of asking models to reproduce them. |
| BILL-01 | Blueprint illustrative plan prices | Intentionally rejected | **Commercial owner.** Runtime prices in `lib/billing/plans.ts` are the launch catalog. |
| BILL-02 | Annual discount | Build now | **Commercial owner.** Exactly ten monthly charges for twelve months; pricing UI derives from runtime plans. |
| BILL-03 | Credit menu | Already delivered | **Billing owner.** `lib/credit-menu.ts` is canonical; overrides are explicit and auditable. |
| BILL-04 | Free-tier decision | Build now | **Commercial owner.** 30 one-time credits, one seat/entity, no direct publishing, watermark media. Missing enforcement is deferred, not implied. |
| BILL-05 | Separate Veo credit bucket | Intentionally rejected | **Commercial/finance owner.** Unified credits plus hard ceiling at launch; reconsider after measured ledger evidence. |
| BILL-06 | Automatic overage and extra-workspace fees | Intentionally rejected | **Commercial owner.** Use top-ups/plan changes; Agency includes up to 25 client workspaces. |
| BILL-07 | Gross-margin thresholds | Build now | **Finance owner.** ≥75% margin/credit and <2% negative-margin workspaces over trailing 30 days. |
| BILL-08 | Provider-cost source and repricing protocol | Build now | **Finance owner.** Usage-at-effective-rate reconciled to invoices; p90/100-sample minimum; unknown price blocks certification. |
| BILL-09 | Agency rebilling | Build now | **Agency/finance owner.** Agency bills clients externally; no pooling, markup, or Citefi-issued client invoice at launch. |
| COACH-01 | “Citefi Coach” one-action Daily Brief | Already delivered | **Daily Brief owner.** Daily Brief exists; campaign-centered recommendations remain downstream. |
| COACH-02 | In-app/email cadence and user control | Already delivered | **Daily Brief owner.** Cadence controls exist; notification consent and deliverability remain operational checks. |
| METRIC-01 | Scorecard formulas and contextual tooltips | Deferred | **Analytics owner.** Use blueprint formulas; no generic marketing glossary page. |
| ETH-01 | Calm confidence, no engagement carnival | Build now | **Product design owner.** No points quotas, fake urgency, shame, punitive streaks, or variable-reward mechanics. |
| ETH-02 | Retention and user capability over session count | Build now | **Product analytics owner.** Session count is never a north-star metric. |
| LAUNCH-01 | Definition of done | Build now | **Release owner.** Typecheck, tested reversible migrations, flags, observability, docs, and evidence are mandatory. |
| LAUNCH-02 | Engineering/security release gates | Deferred | **Release owner.** Current QA is not green; `reports/launch-certification-checklist.md` is the authority. |
| LAUNCH-03 | Ads approval blocks export-only launch | Intentionally rejected | **Release owner.** Google/Meta approval blocks direct publishing only, never a valid export package. |
| LAUNCH-04 | Business success metrics | Build now | **Product/finance owners.** Exact 30/90-day targets and formulas are locked in the launch checklist. |
| LAUNCH-05 | Claim “blueprint complete” before all blocking gates pass | Intentionally rejected | **Release owner.** Until then the accurate claim remains “advanced beta / conditional launch candidate.” |

## Change control

Any change to pricing, credits, margins, free-tier behavior, rebilling, UTM naming, report ownership, ad policy, external approval status, or release thresholds must:

1. update `LAUNCH_POLICY_VERSION`;
2. update the machine-readable default and this register together;
3. identify an accountable owner and reason;
4. include tests for code-consumed values;
5. preserve export-only behavior when a third-party approval is unavailable.