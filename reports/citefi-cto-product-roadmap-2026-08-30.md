# Citefi Future-Proof CTO, Product, Marketing, UI, and UX Roadmap

**Review date:** August 30, 2026  
**Task:** Reconcile the Citefi upgrades document with the current repository  
**Source document:** `attached_assets/citefi_upgrades_1787676880986.docx`  
**Release posture:** **NO-GO / advanced beta / conditional launch candidate**  
**Implementation status:** Review only; no product, migration, integration, UI, infrastructure, secret, or deployment changes were made

## 1. Executive decision

The upgrades document remains strategically useful, but it is no longer an accurate implementation backlog.

The current repository has already delivered substantial foundations that the document describes as future work: a Campaign aggregate, a Campaign Brand Intelligence snapshot/confirmation foundation, BullMQ/Redis workers, reserve/debit/release credit controls, PostgreSQL RLS, provider-usage ledger foundations, Daily Brief foundations, agency/client report separation, immutable deployment tooling, and monitoring/incident foundations. Complete immutable Brand provenance across every derivative remains partial.

The correct plan is therefore **certify and complete before expanding**:

1. **P0 — make the present system safe and certifiable.** Close export authorization, model/accounting, dependency, test, and release-evidence blockers. Do not deploy release `aa28026`.
2. **P1 — make Campaign, cost, and outcome data authoritative.** Normalize the lifecycle, prove immutable Brand context across every derivative, reconcile provider cost, and create durable metric snapshots.
3. **P2 — make approvals and evidence the product.** Consolidate the agency/client experience around decisions, reports, mobile accessibility, GEO/AEO evidence, and permissioned connectors.
4. **P3 — add agents as a governed execution layer.** Agents may read and simulate first, then emit the same tenant-scoped, budgeted, quality-gated jobs the existing pipeline already runs. No autonomous ad spend or publishing.

### CTO verdict

- **Do not replace BullMQ with pg-boss.**
- **Do not recreate Batch as another lifecycle parent.**
- **Do not use the document’s illustrative pricing, separate Veo meter, or automatic overage model.**
- **Do not treat Google/Meta approval as an export-only blocker.**
- **Do not claim live margins, live scorecards, GEO superiority, or autonomous execution without durable evidence.**
- **Do not bypass a failed launch gate.**
- **Do not start P3 autonomy while P0 authorization, accounting, tenant, model, and release controls are unproven.**

The strongest long-term position is not “more AI writers.” It is:

> A local marketing campaign engine that turns one verified business identity into approved, traceable campaigns and evidence-backed next actions across locations and channels.

## 2. Review method and source hierarchy

The review used five evidence layers:

1. **Current repository and tests** — highest authority for what exists.
2. **Locked decision register and launch gates** — highest authority for commercial, product, approval, and release policy.
3. **Signed independent certification** — highest authority for current launch status.
4. **Existing project-task plans and delivered migrations** — authority for planned and partially delivered work.
5. **Upgrade document and current external research** — strategic input, not permission to override repository truth or locked decisions.

Primary internal sources:

- `reports/blueprint-decision-register-2026-08-22.md`
- `reports/launch-certification-checklist.md`
- `reports/external-ads-approval-readiness.md`
- `reports/independent-certification-aa28026-2026-08-29.md`
- `lib/launch-governance.ts`
- `shared/schema.ts`
- `lib/campaign-service.ts`
- `lib/client-brand-profile-service.ts`
- `lib/campaign-ads-service.ts`
- `lib/provider-usage-ledger.ts`
- `lib/queue.ts`
- `lib/pipeline-worker.ts`
- `lib/model-resolver.ts`
- `lib/brief/`
- `lib/agency-report-service.ts`
- migrations `0014` through `0019`

## 3. Upgrade gap matrix

Disposition vocabulary:

- **Delivered** — working foundation exists; applicable certification may still be required.
- **Partial** — meaningful implementation exists, but an end-to-end contract or proof is missing.
- **Missing** — no convincing product/system implementation exists.
- **Stale** — the document describes a past state.
- **Contradictory** — the recommendation conflicts with a locked current decision.
- **External** — completion depends on a third party or company-owned account.

| Upgrade area | Disposition | Current truth | Required decision |
|---|---|---|---|
| DigitalOcean target and process separation | **Partial / stale** | Production remains on the existing DO droplet. Immutable release, staging, PM2, rollback, monitoring, and backup foundations exist. The document’s assumed managed-Postgres/topology state is not repository proof. | Preserve the current manual immutable release model. Do not switch production until release-specific staging, rollback, restore, canary, alert-recipient, and launch gates pass. Separate worker compute before selling SLA-backed availability. |
| GitHub Actions tagged deploy | **Contradictory for current launch** | Current deployment policy is manual-only, built off-host, checksum-verified, and atomically switched through `current`. | Automation may prepare and validate immutable artifacts later, but must not bypass human release authorization or launch gates. Never use `git checkout && build` as production rollback. |
| pg-boss queue architecture | **Stale / contradictory** | BullMQ/Redis is canonical; centralized pipeline worker policy, retries, dedupe, budgets, and credit settlement exist. pg-boss is legacy compatibility only. | Preserve BullMQ. Migrate legacy jobs when justified; do not restore pg-boss merely to match the document. |
| Campaign parent model | **Partial** | Campaign schema, service, migration/backfill, UI, same-team relationships, and Brand snapshot linking exist. Batch remains a generation run. | Normalize the locked lifecycle, finish canonical campaign attribution, prove dual-read retirement, and gate every export through Campaign approval state. |
| Brand Intelligence as source of truth | **Partial** | Brand profiles and immutable Campaign snapshots exist. | Every campaign-derived prompt, asset, report, export, and event must record the Campaign snapshot identity/hash and provenance. Team live profiles must not mutate an in-flight campaign. |
| PostgreSQL tenant RLS | **Partial, not missing** | FORCE RLS design and focused isolation tests exist. | Certify the exact release in the target deployment, including pooled context reset, workers, agency-child access, client-reviewer columns, and every tenant table. RLS stays alongside application guards. |
| Ads Lab export | **Partial** | Deterministic UTM, landing checks, policy results, manifests, ZIP/export concepts, and export-only policy exist. | Enforce distinct client, policy/compliance, and agency-owner approvals server-side on every export path. Preserve immutable receipts and the exact manual-upload notice. |
| Direct Google/Meta publishing | **External / intentionally disabled** | Approval status is `NOT STARTED`; direct publishing and spend remain disabled. | Export-only continues. Each platform needs external approval plus a separate direct-publish certification before any feature flag can be considered. |
| Pricing examples and two-meter design | **Contradictory** | Runtime plans and unified credit menu are locked. No automatic metered overage. Separate Veo credits are rejected for launch. | Use measured provider cost to tune ceilings and future catalog decisions, not to silently replace the current catalog. Changes require policy-version change control. |
| Credit reserve/reconcile | **Delivered foundation / partial proof** | Reserve → debit/release, spending caps, idempotency, and centralized worker policy exist. | Finish reproducible release evidence for concurrency, retries, stale cleanup, partial settlement, refunds, and fail-closed generation endpoints. |
| Provider usage and margin truth | **Partial** | Append-only rates/usage and financial separation exist. One incident-AI provider path escapes accounting; production p90/sample/invoice evidence is absent. | Instrument every paid call, retain failed-call cost, reconcile invoices, and block certification for unknown/zero-priced models. No pricing/margin claim before evidence. |
| Task-specific model routing | **Partial** | Model resolver, fallback chains, and tier validation foundations exist. | Critical billable tiers must fail closed when no live, priced, approved model is validated. Fallbacks must be prevalidated and accounted, not silent. |
| Video two-path strategy | **Partial / policy adjusted** | Stitched and Veo-related generation/reliability foundations exist. | Keep assembled video as safe default and full-motion video gated/capped. Use unified credits. Exact brand assets must be composited, not regenerated. Certify real delayed retries and provider cost. |
| OAuth connection states | **Partial** | Social/publishing OAuth foundations and recoverable states exist. | Add a provider-neutral tenant-scoped capability/consent registry before new analytics or ad connections. Connection does not imply permission to publish or spend. |
| Daily Marketing Brief | **Delivered foundation / partial product** | Generation, cadence, channel, timezone, data assembly, and admin foundations exist. | Evolve it into a campaign-centered next-decision and outcome surface. Replace automation-overstating language and measure beneficial actions, not opens alone. |
| Marketing scorecard | **Partial / missing durable input layer** | Event and reporting foundations exist, but no certified source/freshness/attribution snapshot contract supports “live” claims. | Build durable metric snapshots and immutable report inputs. Show unavailable/estimated states honestly; never fabricate CAC, CLV, ROAS, or attribution. |
| White-label agency reporting | **Partial** | Agency-private and client-safe snapshots, approvals, delivery, and rebilling export foundations exist. | Complete metric/provider reconciliation, campaign evidence, mobile/client UX, and release certification. Keep provider cost and internal margin out of client copies. |
| Emotional design | **Direction accepted; implementation uneven** | Calm-confidence policy is locked. Existing product copy/navigation still drifts toward feature factories and engagement language. | Tie motivation only to verified progress. Ban fake urgency, punitive streaks, variable rewards, shame, and credit-spend celebration. |
| GEO/AEO | **Missing as an evidence product** | SEO metadata/content foundations are not a durable answer-engine citation loop. | Build measurement, source capture, entity consistency, citation visibility, and experiments. Do not market unsupported “GEO hacks.” |
| Agentic workflows | **Partial foundations / missing governance** | Learning, decisioning, jobs, budgets, approvals, and agent-like modules exist. | Add a tenant capability registry, simulations, cost previews, approval policies, replayable receipts, cancellation, and rollback before execution autonomy. |
| MCP | **Missing** | No certified tenant-scoped MCP consume/expose security plane exists. | Start read-only and internal. Require per-client consent, least privilege, SSRF defenses, tool provenance, budgets, and high-impact approval. |
| “Proprietary local data moat” | **Strategic hypothesis** | Brand, campaign, event, and report data could compound, but quality, consent, coverage, and outcome validity are not yet proven. | Treat as a measured option. No cross-client benchmark product without privacy review, minimum cohorts, aggregation controls, and customer consent. |

## 4. Corrections to the upgrades document

### 4.1 Preserve these recommendations

- Campaign as the sole lifecycle parent.
- Batch as a generation-run concept during migration.
- Immutable Campaign Brand Intelligence inputs.
- Reserve credits before paid work and separately record actual provider cost.
- Retain failed-provider spend even when credits are released.
- Hard job/workspace/provider ceilings and bounded retries.
- Exact brand assets are composited after generation.
- One highest-value Daily Brief action with honest quiet states.
- Durable metric snapshots rather than direct “live dashboard” calls.
- Human approval before consequential external action.
- Calm, competence-building emotional design.
- GEO/AEO and agent/MCP work as future options that compound local evidence.

### 4.2 Replace these recommendations

| Document recommendation/assumption | Replacement |
|---|---|
| pg-boss as the target queue | BullMQ/Redis remains canonical. |
| Deploy by checking out a tag and rebuilding on production | Build immutable artifacts off-host, verify checksums, atomically switch `current`, and preserve rollback artifacts. |
| Automatic Stripe overage | Top-up or plan change only at launch. |
| Separate Veo credit meter | Unified credits plus hard run/provider ceilings. |
| Illustrative $79–$799 packaging and derived credits | Runtime plan catalog and `CREDIT_MENU` remain authoritative until measured, reconciled evidence supports a governed change. |
| “Live” marketing metrics | Durable snapshots with source, observed time, freshness, attribution model, and quality/confidence. |
| Connection equals activation | Connection, capability grant, approval authority, and action execution are separate states. |
| Google/Meta approval blocks Ads value | Export remains useful; approval blocks direct publishing only. |
| General chat first | Approval and evidence workflows first; conversational access is optional and later. |
| Agent abstraction now, broad autonomy later by default | Add governance contracts first, then read/simulate, then narrow approved actions. |

### 4.3 Reject unsupported claims

- Do not claim that Citefi’s Daily Brief is categorically unique without a repeatable competitive review.
- Do not claim a specific share of search has moved to AI answers unless the source, geography, query class, and date are reproducible.
- Do not promise GEO ranking/citation outcomes.
- Do not state model or video cost from a static document as production truth.
- Do not claim that an agent can safely publish, spend, or reallocate budgets because it can call a tool.
- Do not use “AI visibility,” “ROAS,” “CLV,” or “profit” when inputs are incomplete or estimated without labels.

## 5. Current market and standards evidence

External sources were checked on August 30, 2026.

### 5.1 GEO/AEO: evidence beats tricks

Google’s current guidance says generative Search features still rely on core ranking systems and foundational SEO. It explicitly discourages unsupported AI-specific tricks such as special chunking, AI-only text files, or keyword rewrites; useful, unique, well-structured content remains the foundation.

**Product consequence:** Citefi should build a measured AI-visibility and citation evidence loop, but should not sell a collection of unverified “GEO hacks.” The product advantage should be verified local entities, factual consistency, source-backed claims, original local evidence, and measurable answer-engine visibility.

Source:

- Google Search Central, [Optimizing your website for generative AI features on Google Search](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)

### 5.2 Agency table stakes

BrightLocal, Semrush, and Vendasta publicly emphasize combinations of multi-client management, local visibility/rank tracking, listings/reputation, competitor analysis, consolidated workflows, automated or white-label reporting, CRM/lead workflows, and proof of ROI.

**Product consequence:** dashboards, reports, local rank data, AI content, and generic automation are not durable differentiation alone. Citefi should differentiate through:

- one URL to one governed Campaign;
- immutable local Brand evidence;
- multi-asset, multi-location approval bundles;
- explainable next decisions;
- export receipts and compliance boundaries;
- agency-private economics with client-safe outcomes;
- measured citation/answer visibility;
- trustworthy, reversible execution.

Sources:

- BrightLocal, [Local SEO tools for agencies](https://www.brightlocal.com/agencies/)
- Semrush, [Semrush for agencies](https://www.semrush.com/solutions/agencies/)
- Vendasta, [Agency and enterprise management platform](https://www.vendasta.com/platform/)

### 5.3 MCP and agent safety

The MCP security guidance calls out confused-deputy and authorization risks and requires per-client consent. OWASP guidance emphasizes least privilege, input/tool validation, human approval for high-impact actions, and controls against malicious or compromised tools. MCP clients also need OAuth endpoint and SSRF protections.

**Product consequence:** MCP is not a connector shortcut. It is a new trust boundary.

Sources:

- Model Context Protocol, [Security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
- OWASP, [AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)

### 5.4 Google and Meta access

Google Ads API access requires a developer token and review, with additional compliance obligations at higher access levels. Meta Marketing API access beyond development/own-account use requires its authorization and review process; permissions and production access must be proven, not inferred.

**Product consequence:** external approval remains a managed company process and a separate certification surface. Export-only delivery must continue regardless of approval timing.

Sources:

- Google Ads API, [Access levels and Required Minimum Functionality](https://developers.google.com/google-ads/api/docs/productionize/access-levels)
- Meta Marketing API, [Authorization](https://developers.facebook.com/docs/marketing-api/get-started/authorization/)

### 5.5 WCAG 2.2

WCAG 2.2 adds or strengthens requirements directly relevant to approval workflows: focus must not be obscured, dragging needs a non-drag alternative, minimum targets are 24×24 CSS pixels at AA, help placement should be consistent, repeated entry should be reduced, and authentication must not require an inaccessible cognitive test.

**Product consequence:** accessibility is a release characteristic of onboarding, review, approval, export, client switching, and reports—not a public-page smoke check.

Source:

- W3C WAI, [What’s New in WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)

## 6. Durable target architecture

### 6.1 Campaign boundary

- `Campaign` is the tenant-scoped aggregate and lifecycle authority.
- `Batch` is a retryable generation run within a Campaign.
- Content, social, media, ads, reports, approvals, exports, provider usage, and outcomes reference the Campaign.
- The locked lifecycle is:
  `DRAFT → INTERNAL_REVIEW → CLIENT_APPROVED → EXPORT_READY → EXPORTED`.
- Side states such as paused, failed, cancelled, archived, or needs-attention are operational states, not replacements for approval progression.
- Lifecycle transitions are server-authorized, append-only in the audit history, and idempotent.

### 6.2 Brand Intelligence boundary

- The team’s live Brand profile is editable knowledge.
- A Campaign freezes a versioned, immutable Brand snapshot before generation.
- Every derivative records the snapshot ID/hash and any approved override.
- Regulated-industry rules and disclaimers are part of the frozen campaign policy context.
- Refreshing Brand Intelligence creates a new candidate version; it does not mutate existing Campaign evidence.

### 6.3 Ads boundary

- Ads Lab generates deterministic Google RSA and Meta packages.
- It does not publish, spend, bid, or imply platform approval.
- Export requires separate evidence for:
  1. immutable asset version;
  2. Brand confirmation;
  3. internal review;
  4. designated client approval;
  5. policy/compliance approval;
  6. agency-owner export authorization.
- Every package includes canonical UTMs, landing checks, policy/disclaimer results, approvers, timestamps, content hashes, and:
  **“Manual review and platform upload required.”**

### 6.4 Provider accounting boundary

- Customer credits and provider COGS remain separate ledgers.
- Every paid attempt writes append-only provider usage, including failed calls.
- Events link tenant, Campaign, run/job, content, provider, resolved model, units, effective rate card, monetary cost, credit reservation, attempt, and idempotency key.
- Unknown model, missing price, missing attribution, or accounting failure blocks billable execution or certification; it never becomes zero-cost.
- Corrections are compensating events, not mutation.
- Margin reports require effective-rate valuation plus provider invoice reconciliation.

### 6.5 Queue and execution boundary

- BullMQ/Redis is canonical.
- Jobs carry canonical tenant/Campaign/run/reservation/snapshot identifiers.
- Workers re-authorize tenant, budget, model, policy, and reservation state at execution time.
- Pipeline policy owns classification, retry, release/debit, and fatal behavior.
- Process separation prevents media/crawl pressure from taking down the web tier.
- Agent work later enters through the same queue and policy boundary.

### 6.6 Tenant and authorization boundary

- PostgreSQL RLS is default-deny and forced on tenant roles.
- Request and worker queries execute in a transaction-scoped tenant context.
- App guards remain defense in depth.
- Agency-parent access is explicit and narrow; it is not “first membership wins.”
- Client reviewers receive only approved client-safe fields.
- Approval authority is role- and assignment-specific; admins do not silently substitute for business approval.

### 6.7 Event and metric boundary

Use two distinct immutable streams:

1. **Operational/domain events:** generation requested, review requested, version approved, export authorized, job failed, report sent.
2. **Observed metric snapshots:** source, account/connection, Campaign/location/channel, metric name, interval, observed time, ingested time, attribution model, units, value, freshness, confidence/quality, and source payload hash.

Reports and Daily Brief recommendations consume versioned snapshots through a consistency barrier. They never query a mix of mutable live providers mid-render.

### 6.8 GEO/AEO boundary

- GEO/AEO is an evidence product, not a guaranteed optimization outcome.
- Maintain canonical local entities, locations, services, claims, sources, and dates.
- Store answer-engine observations as snapshots: query, locale/location, engine, date, response/citation evidence, Citefi/client presence, competitor presence, and confidence.
- Respect provider/platform terms and do not silently automate prohibited querying.
- Separate observed visibility from inferred recommendations.
- Every recommendation explains its evidence and uncertainty.

### 6.9 Connector boundary

- A connection record is tenant-scoped and encrypted.
- Connection state, granted scopes, account selection, consent owner, revocation, refresh, health, and last successful sync are explicit.
- A capability registry translates scopes into allowed read/write actions.
- Connecting an account never grants publishing, spending, or Campaign approval authority.
- Start analytics connectors read-only; require a separate gate for each write capability.

### 6.10 MCP and agent boundary

- MCP servers and tools are registered, versioned, classified, and tenant-scoped.
- Tool metadata is not trusted as authorization.
- Each capability declares data class, read/write effect, external side effect, maximum cost, approval policy, idempotency, timeout, rollback/compensation, and audit schema.
- The execution progression is:
  `read → recommend → simulate → prepare diff → approve → execute narrow action`.
- High-impact actions always require current human approval.
- Agents cannot approve their own work, broaden scopes, change budgets, publish ads, or spend money.
- Every action is replayable from immutable plan, tool, input, approval, output, and cost records.

## 7. Human-centered product and UX model

### 7.1 Roles, anxieties, and decision rights

| Role | Primary job | Main anxiety | Required authority | Must not see/do |
|---|---|---|---|---|
| Agency owner | Protect reputation and margin across clients; authorize delivery | Wrong client, hidden cost, unapproved export | Create/archive clients, assign operators/approvers, see private economics, approve report config, final send/export authorization | Cannot substitute for missing client or compliance approval unless an explicit policy permits it |
| Agency operator | Move Campaigns from brief to review efficiently | Missing context, duplicate edits, unclear blocker/owner | Create/edit Campaigns and assets, request reviews, resolve feedback, prepare exports/reports | Cannot impersonate client approval or final owner authorization |
| Client approver | Verify facts, brand, offer, legal, and local accuracy | Approving an unseen revision or accidentally publishing | View assigned client-safe assets, comment, request changes, approve one exact version | No provider cost, credits/margin, prompts, internal errors, other clients, or ad spend/publish |
| Local-business owner | Get effective marketing without becoming a marketer | Time, authenticity, spend risk, loss of control | Confirm Brand facts, accept/edit plan, approve assets, satisfy policy checks, authorize own export | No implied automation or hidden external action |

Product/Compliance owns policy approval. A regulated vertical without review or an unresolved required disclaimer blocks export.

### 7.2 Approval-centric information architecture

Limit the primary product navigation to seven job-led areas:

1. **Today** — one recommended action, assigned decisions, and failures needing remedy.
2. **Campaigns** — the lifecycle parent and progress workspace.
3. **Review** — unified role-filtered Brand, asset, ad, report, and export approvals.
4. **Library** — draft/approved assets and immutable export packages.
5. **Results** — sourced metric snapshots and reports with honest unavailable states.
6. **Clients** — agency-only portfolio, approvers, health, and reporting.
7. **Settings** — team, workspace, connections, billing, and notification preferences.

Creation Labs move inside Campaign “Create.” Admin remains in a separate authorized shell.

Each Campaign opens on **Next decision** with tabs for Overview, Assets, Review & approvals, Results, and Activity. A readiness panel names each blocker, owner, due/requested date, approved version, consequence, and remedy.

### 7.3 Key journeys

**Agency owner**

`Today portfolio exceptions → client/Campaign → approval chain + private economics → authorize export/report → manual delivery → immutable receipt`

**Agency operator**

`Business URL → verify Brand snapshot → goals/locations/assets → generate/edit → internal review → designated client review → resolve versioned feedback → prepare export → owner authorization`

**Client approver**

`Secure deep link/sign-in → assigned decisions → full responsive preview + changes → factual/disclaimer checklist → approve exact version or request changes → confirmation that nothing was published`

**Local-business owner**

`URL onboarding → correct/confirm Brand facts → accept plan and credit estimate → review in plain language → approve → policy checks → authorize/download with manual-upload guidance → sourced results and next action`

### 7.4 Mobile and accessibility acceptance

- Complete onboarding, review, approval, export, client switch, and report flows with keyboard only.
- Visible focus is never obscured by sticky headers, dialogs, or bottom action bars.
- Reflow at 320 CSS px and 200% zoom without two-dimensional page scrolling or lost actions.
- Prefer 44×44 touch targets; never fall below WCAG’s 24×24 minimum without a valid exception.
- No hover-only information; no drag-only interaction.
- Status is never color-only.
- Error messages identify field, cause, and remedy while preserving input.
- Approval/export confirmations announce status without moving focus unexpectedly.
- Full asset/version context is available before any approval.
- Reduced motion is honored; sound is off by default.
- Automated accessibility checks are supplemented by keyboard, NVDA/Chrome, and VoiceOver/Safari tests for critical flows.
- Release target: zero serious/critical accessibility violations in critical journeys.

### 7.5 Ethical emotional-design guardrails

Use:

- specific evidence;
- visible, meaningful progress;
- calm confidence;
- honest quiet states;
- user-controlled cadence;
- informational celebrations tied to real business outcomes;
- language that credits the user;
- reversible next actions.

Never use:

- fake urgency or countdowns;
- shame or guilt notifications;
- punitive streak resets;
- variable rewards or slot-machine mechanics;
- celebrations for spending credits;
- session count as a north-star metric;
- “execute now” when the action still needs review;
- competitor fear without evidence and a constructive remedy.

## 8. Prioritized roadmap

### P0 — certify the current platform before expansion

#### P0.1 Enforce approval and export authorization

- **User outcome:** No person can self-approve a Campaign through prerequisite and final export stages.
- **Existing coverage:** `ads-lab-export.md`, `campaign-workflow.md`, follow-up task “Prevent campaign self-approval and unapproved exports.”
- **Dependencies:** Locked role matrix and Campaign lifecycle.
- **Risk:** Existing generic Campaign export remains a bypass even if the Ads route is fixed.
- **Acceptance:** Every export path enforces lifecycle state, distinct prerequisite actors, agency-owner authorization, immutable version/hash, policy/disclaimer completion, and the manual-upload notice. Negative authorization tests cover ordinary members, wrong client, reused tokens, stale versions, and cross-tenant IDs.
- **Measure:** 0 approval/export bypasses; 100% packages have complete receipts.
- **Non-goals:** Direct Google/Meta publishing, automatic delivery, inferred approval.
- **Reversible decision:** Keep export disabled or download-only if any prerequisite cannot be proven.

#### P0.2 Certify tenant and admin isolation on the exact release

- **User outcome:** Agency and client data cannot cross boundaries even when an application filter is missed.
- **Existing coverage:** `database-tenant-isolation.md`, `api-hardening.md`, release-certification plans.
- **Dependencies:** Versioned migrations and transaction-scoped database roles.
- **Risk:** Pool/context leakage or an uncovered table/route creates an IDOR despite passing focused tests.
- **Acceptance:** Complete table and route inventory; FORCE RLS in release target; 0 unauthorized reads/writes for member, agency parent, client reviewer, worker, and admin paths; pooled context reset and column restrictions pass.
- **Measure:** 0 cross-tenant failures; 100% tenant tables dispositioned; 100% admin routes deny non-admin users.
- **Non-goals:** Replacing authentication or redesigning client pages.
- **Reversible decision:** Roll back the release rather than weakening RLS or adding a bypass role.

#### P0.3 Make model and provider accounting fail closed

- **User outcome:** Citefi never spends on an unvalidated model or hides a provider cost.
- **Existing coverage:** `provider-margin-accounting.md`, `credit-cost-telemetry.md`, `unified-generation-orchestrator.md`, follow-up “Make every AI cost visible in margin and incident records.”
- **Dependencies:** Model resolver, rate cards, provider ledger, reservation state.
- **Risk:** Silent fallbacks, direct SDK calls, or unknown prices create unbounded cost and false margin.
- **Acceptance:** Every paid boundary is inventoried and contract-tested; critical unresolved tiers stop before spend; every fallback is validated/priced; failed attempts are recorded; incident AI is accounted; provider canary passes without fake success.
- **Measure:** 100% paid attempts attributed; 0 unknown/zero-priced events in certifiable periods; 0 direct provider calls outside the boundary.
- **Non-goals:** Selecting a permanent vendor or repricing plans.
- **Reversible decision:** Disable the affected operation while preserving non-paid/manual workflows.

#### P0.4 Restore release engineering evidence

- **User outcome:** A release reaches production only when its exact code and environment have reproducible proof.
- **Existing coverage:** `release-safety-gate.md`, `production-readiness.md`, `final-blueprint-certification.md`.
- **Dependencies:** P0.1–P0.3, stable test harness, immutable artifact.
- **Risk:** Passing local/build evidence is mistaken for release-specific operational proof, or backend suites are mistaken for proof that protected user journeys work.
- **Acceptance:** Typecheck, auth/admin/approval/billing/failure/restart suites, high-risk dependency policy, isolated staging migration, canary, cutover, rollback/redeploy, DB/media restore, and alert-recipient drills all pass for one immutable candidate. The approved secure configuration contains the required existing token-encryption secret without exposing it, and token encryption, recovery, revocation, and rotation behavior are proven. Role-separated browser journeys pass for agency owner, agency operator, client reviewer, local-business owner, and admin across sign-in, billing, Campaign creation, generation, review, approval, export, and report delivery.
- **Measure:** 100% mandatory gates pass; 0 security/billing/external-approval waivers.
- **Non-goals:** Deploying `aa28026`, changing production while a gate is red, selling an SLA.
- **Reversible decision:** Production remains unchanged; rollback uses the prior immutable release.

#### P0.5 Remove high-risk dependency blockers

- **User outcome:** Launch-critical paths do not rely on known high-severity vulnerable packages without a governed exception.
- **Existing coverage:** Follow-up task “Remove high-risk dependency vulnerabilities before launch.”
- **Dependencies:** Reachability review and regression suite.
- **Risk:** Broad upgrades destabilize a large dependency graph.
- **Acceptance:** Every high finding is upgraded, removed, or formally shown unreachable under policy; affected auth/routing/database/media paths pass focused regression.
- **Measure:** 0 unaccepted critical/high launch-policy findings.
- **Non-goals:** Chasing low-risk version freshness unrelated to reachable product behavior.
- **Reversible decision:** Upgrade in isolated groups with lockfile/checkpoint rollback.

**P0 exit gate:** A fresh independent certification says the named release and surface are launch-ready. P1 discovery may proceed in parallel; P1 production rollout may not weaken or bypass P0 controls.

### P1 — establish authoritative Campaign, cost, and outcome data

#### P1.1 Normalize the Campaign lifecycle and canonical context

- **User outcome:** Every asset and decision is visibly part of one Campaign.
- **Existing coverage:** `campaign-workflow.md`; Campaign migration/service/UI tests.
- **Dependencies:** P0 export controls.
- **Risk:** Legacy `ACTIVE/PAUSED/COMPLETE`, Batch-centric routes, and mixed read paths create two products.
- **Acceptance:** Locked lifecycle is authoritative; social and every derivative carry canonical Campaign/snapshot context; backfill is idempotent; dual-read has explicit retirement criteria; legacy links remain compatible during a time-boxed window.
- **Measure:** 100% Campaign-derived records attributable; 0 orphaned new work; declining legacy-read share to zero before removal.
- **Non-goals:** Replacing generators or renaming database `team` to `workspace`.
- **Reversible decision:** Additive writes and dual-read remain until reconciliation proves safe.

#### P1.2 Prove provider cost and margin truth

- **User outcome:** Agency and platform owners can see which Campaigns and operations are sustainable without exposing private economics to clients.
- **Existing coverage:** `provider-margin-accounting.md`, `usage-metering.md`, `credit-cost-telemetry.md`, provider-ledger migrations, agency-report boundaries.
- **Dependencies:** P0.3 and Campaign attribution.
- **Risk:** Partial coverage, retries, failed calls, or stale rate cards make margin look better than reality.
- **Acceptance:** Actual usage for text/image/audio/video/research and fallbacks; effective-time rate cards; corrections via compensating events; invoice reconciliation; p90 with ≥100 successful samples per operation; failed-cost line; agency-private and admin views.
- **Measure:** Reconciliation variance within a locked tolerance; ≥75% trailing-30-day gross margin per credit; <2% negative-margin active workspaces.
- **Non-goals:** Automatic client rebilling, client-visible provider COGS, illustrative price promises.
- **Reversible decision:** Keep current prices/ceilings and disable underpriced operations until change control approves a catalog adjustment.

#### P1.3 Add durable metric snapshots and reporting consistency

- **User outcome:** Results, reports, and recommendations use the same dated evidence and clearly disclose missing data.
- **Existing coverage:** conversion/read and engagement-event plans, white-label reports, and the Daily Brief foundation. A legacy agency-expansion plan mentions GEO/AEO, but that duplicated plan is superseded because its pooled-credit, media-meter, rollover, and packaging rules conflict with the locked policy.
- **Dependencies:** Campaign attribution and connector source identity.
- **Risk:** Mixed live reads, attribution drift, duplicated ingestion, or late data creates contradictory reports.
- **Acceptance:** One versioned snapshot contract; source/observed/ingested/freshness/attribution/quality fields; idempotent ingestion; immutable report snapshot barrier; explicit unavailable/estimated states; correction/replay policy.
- **Measure:** Snapshot freshness SLA by source; duplicate rate; late/corrected event rate; 100% report values trace to source snapshots.
- **Non-goals:** A universal warehouse rewrite, real-time claims for batch sources, inventing unavailable revenue.
- **Reversible decision:** Keep source adapters behind the snapshot contract; reports can fall back to “not available” without fabricating values.

### P2 — make approvals, local evidence, and agency outcomes the experience

#### P2.1 Consolidate approval-centric Campaign UX

- **User outcome:** Each role knows what needs a decision, which version is in scope, who owns it, and what happens next.
- **Existing coverage:** Campaign workspace, client dashboard/review, report approval, Daily Brief, agency/client task plans.
- **Dependencies:** P1.1 and P1.3.
- **Risk:** A navigation redesign without lifecycle truth creates another cosmetic layer.
- **Acceptance:** Seven-or-fewer primary destinations; unified role-filtered Review; named assignee/type/version/blocker/history; Campaign readiness panel; client-safe previews; no export/publish ambiguity; job-led language.
- **Measure:** ≥90% approvals without support; <2% reopened for version confusion; p75 review ≤3 minutes; 0 bypasses.
- **Non-goals:** Chat-first replacement of structured work or merging admin into client UX.
- **Reversible decision:** Introduce the new shell behind role/workspace flags while preserving deep links.

#### P2.2 Certify mobile and WCAG 2.2 AA critical journeys

- **User outcome:** Owners and approvers can safely complete work one-handed, with keyboard, or with assistive technology.
- **Existing coverage:** Public accessibility smoke only.
- **Dependencies:** P2.1 interaction contracts.
- **Risk:** Retrofitting after an IA redesign doubles work and leaves consequential controls inaccessible.
- **Acceptance:** Section 7.4 criteria pass for onboarding, review, approval, export, client switching, and reports; manual NVDA/VoiceOver evidence retained.
- **Measure:** 0 serious/critical violations; first-attempt success ≥85% mobile and ≥90% desktop; critical-flow parity across input modes.
- **Non-goals:** Cosmetic redesign unrelated to critical tasks.
- **Reversible decision:** Keep old flow available until new flow reaches accessibility and task-success thresholds.

#### P2.3 Build a GEO/AEO evidence product

- **User outcome:** A local business sees where it is cited or absent in answer experiences, what evidence supports the finding, and which factual improvement is worth making.
- **Existing coverage:** Event/metric and Brand Intelligence foundations only. `task-9.md` and `agency-enterprise-expansion.md` duplicate one another and combine GEO/AEO with rejected pooled-credit, separate media-credit, rollover, and illustrative packaging rules; they must not be executed as written. Any compatible Geo-Entity/AEO intent should be extracted into a clean evidence-product task governed by this roadmap.
- **Dependencies:** P1.3 snapshots, Brand entities, compliant source access.
- **Risk:** Terms-of-service violations, volatile answer output, vanity scores, and causal claims from observations.
- **Acceptance:** Repeatable query/location/engine sampling; captured citations and timestamps; entity consistency checks; competitor comparison with source links; confidence and missing-data labels; experiments distinguish observation from recommendation.
- **Measure:** observation coverage/freshness; citation share by controlled query set; recommendation acceptance; downstream qualified actions, not promised ranking.
- **Non-goals:** Guaranteed placement, unsupported `llms.txt`/chunking tricks, scraping prohibited interfaces.
- **Reversible decision:** Keep each engine adapter removable and preserve the canonical entity/snapshot layer.

#### P2.4 Turn Daily Brief and reports into outcome workflows

- **User outcome:** The brief routes each person to one beneficial Campaign decision; the report explains completed work and sourced outcomes.
- **Existing coverage:** Daily Brief foundation, `white-label-reports.md`, Campaign/report migrations.
- **Dependencies:** P1.3 and P2.1.
- **Risk:** Notification wallpaper, false urgency, or recommendations based on stale/partial data.
- **Acceptance:** Recommendation cites source/freshness/why; “nothing material changed” is valid; user-controlled cadence; portfolio exceptions for agency owners; reports freeze evidence and preserve private/client-safe separation.
- **Measure:** recommendation-to-relevant-decision rate; completed beneficial actions; dismiss/snooze/not-useful rate; report view/delivery; perceived control and confidence.
- **Non-goals:** Optimizing opens or sessions, automatic delivery, fear-based competitor prompts.
- **Reversible decision:** Rules-based prioritization remains a baseline; learned ranking ships only after offline evaluation and rollback thresholds.

#### P2.5 Add permissioned read-first connectors

- **User outcome:** Users understand what is connected, what Citefi can read or do, and how to repair or revoke access.
- **Existing coverage:** Provider-specific OAuth foundations; no complete cross-provider capability registry.
- **Dependencies:** Tenant/RLS certification, P0 secure token-encryption configuration and proof, P1.3 source contracts.
- **Risk:** Scope creep, token leakage, silent expiration, confused account selection, and accidental write privileges.
- **Acceptance:** Tenant-scoped encrypted credentials; explicit scopes/account/consent owner; five recoverable states; revoke/delete; sync receipts; read-only GA4/GSC/GBP or other approved analytics before write capabilities; agency-parent delegation is explicit.
- **Measure:** successful sync rate, stale-token recovery, time to connect, revocation completeness, 0 unauthorized account access.
- **Non-goals:** Direct ad publishing, automatic spend, collecting passwords, organization-wide access by implication.
- **Reversible decision:** Disable one connector without degrading Campaign/export workflows.

### P3 — guarded MCP and agent execution

#### P3.1 Build a capability and audit plane

- **User outcome:** Teams can safely expose or consume narrowly defined tools without losing tenant, cost, or approval control.
- **Existing coverage:** Queue, tenant, budget, approval, event, and agent-like foundations; no complete MCP plane.
- **Dependencies:** P0 controls, P1 events/cost, P2 connectors and UX.
- **Risk:** Confused deputy, SSRF, tool poisoning, prompt injection, excessive scope, nondeterministic replay.
- **Acceptance:** Registry with provider/tool/version/data class/effect/cost/approval/idempotency/rollback; per-client consent; HTTPS/OAuth validation and egress controls; least privilege; tool allowlists; immutable invocation receipts; kill switch.
- **Measure:** 100% calls authorized and attributable; 0 unapproved write effects; budget variance; denied-action rate; replay completeness.
- **Non-goals:** Open-ended third-party tool execution, trust based only on tool annotations, ad spend/publishing.
- **Reversible decision:** Start internal/read-only; every server/tool can be disabled independently.

#### P3.2 Introduce agents progressively

- **User outcome:** Citefi prepares higher-quality work and next steps while the human retains control over consequential decisions.
- **Existing coverage:** Learning/decisioning, Campaigns, Daily Brief, pipeline jobs, approvals.
- **Dependencies:** P3.1 and P2 approval experience.
- **Risk:** Self-approval, silent external effects, runaway cost, low-confidence actions, automation bias.
- **Acceptance:** Suggest-only → simulate → prepare versioned diff → explicit approval → narrow execution. Plans include evidence, confidence, cost estimate, budget, tools, expected effects, and cancellation/compensation. Agents cannot alter their authority or approve their output.
- **Measure:** accepted recommendation rate, edit distance, task success, cost forecast error, rollback/cancellation rate, override reasons, incident rate.
- **Non-goals:** Fully autonomous marketing, autonomous spend reallocation, direct ad publishing, replacing deterministic policy checks.
- **Reversible decision:** Keep all write actions in suggest-only mode until each capability earns promotion through audited evidence.

**P3 exit gate:** Narrow agent actions may be certified individually. There is no blanket “autonomy enabled” state.

## 9. Dependencies and implementation sequence

```text
P0 approval/export ─┐
P0 tenant/admin ────┼──> P0 independent certification
P0 model/accounting ┤
P0 release/deps ────┘

P0 certification
  ├──> P1 Campaign normalization ──────┐
  ├──> P1 provider/margin truth ───────┼──> P2 approval UX + reports/briefs
  └──> P1 metric snapshots ────────────┘

P1 metric snapshots + Brand entities ─────> P2 GEO/AEO evidence
P0 tenant/security + P1 snapshots ─────────> P2 read-first connectors
P2 connectors + approval UX + P1 audit/cost -> P3 MCP capability plane
P3 capability plane + Campaign jobs ───────> P3 narrow approved agents
```

Parallel work allowed:

- Product discovery, UX research, and source-contract design may occur while P0 is being fixed.
- No P1–P3 feature may weaken P0 controls or be used to justify a launch claim.
- External Google/Meta applications may proceed independently, but direct publishing stays disabled.

## 10. Existing project-task reconciliation

Do not create duplicate epics for the following:

| Roadmap domain | Existing project coverage | Roadmap treatment |
|---|---|---|
| Campaign aggregate/migration | `campaign-workflow.md` | Continue as lifecycle normalization, canonical context, compatibility retirement, and certification—not a rebuild. |
| Ads export | `ads-lab-export.md`, existing export-only Ads task, follow-up on self-approval | One export-governance stream. Direct publishing remains separate and externally gated. |
| Tenant isolation | `database-tenant-isolation.md` | Implementation exists; focus on exact-release deployment and regression evidence. |
| Provider cost/margin | `provider-margin-accounting.md`, `credit-cost-telemetry.md`, `usage-metering.md`, related cost task, follow-up on unaccounted AI | Consolidate into boundary coverage, reconciliation, and role-safe margin views. |
| Credits and Stripe | `credit-ledger-metering.md`, `credit-plans.md`, `stripe-billing.md`, `stripe-billing-paywall.md`, `client-dashboard.md` | Treat as one monetization/control stream; do not create a competing ledger or overage model. |
| Model/generation policy | `unified-generation-orchestrator.md` | Complete provider/model path inventory and fail-closed certification. |
| Release safety | `release-safety-gate.md`, `production-readiness.md`, `final-blueprint-certification.md` | One certification program with immutable evidence; no waiver backlog. |
| Brand Intelligence | `client-intelligence-engine.md`, existing refresh/injection/health tasks | Preserve immutable Campaign snapshot rule and close generator coverage. |
| Events/metrics | `conversion-read-event-ingestion.md`, `engagement-signal-ingestion.md`, existing successor tasks | Consolidate around one event spine and one durable metric-snapshot contract. |
| GEO/AEO and agency expansion | `task-9.md`, `agency-enterprise-expansion.md` | These are duplicate legacy plans and are **superseded as written**. Their pooled credits, separate media-credit bucket, rollover, and illustrative packaging conflict with locked policy. Salvage only compatible Geo-Entity/AEO intent into a clean evidence task. |
| Competitive intelligence | `competitive-intelligence-service.md`, existing generator/provenance tasks | Continue as sourced Campaign input; do not duplicate as a new “agent.” |
| Learning/decisioning/journeys | `bayesian-decisioning-holdout.md`, `cohort-strategy-intelligence.md`, `journey-orchestrator.md`, related project tasks | Sequence as one evidence-to-decision program; avoid overlapping UI and routing epics. |
| Agency reporting | `white-label-reports.md`, `agency-enterprise-expansion.md` | Complete sourced outcomes, accessibility, and certification; preserve client-safe financial separation. |
| Security dependencies | Existing follow-up “Remove high-risk dependency vulnerabilities before launch” | Keep as P0 release work. |

### Existing work that should be amended, not duplicated

1. Add distinct-actor negative tests and generic-export gating to Campaign/Ads work.
2. Add canonical Brand snapshot propagation and dual-read retirement criteria to Campaign work.
3. Add fail-closed model certification and all-paid-boundary coverage to provider/orchestrator work.
4. Add source/freshness/attribution and immutable report barriers to event/report work.
5. Replace the duplicated legacy agency-expansion/GEO plans with one clean GEO/AEO evidence scope; do not carry forward pooled-credit, separate-media-meter, rollover, or superseded packaging rules.
6. Add Campaign decision routing and value-based measurement to Daily Brief/report work.

### Genuinely uncovered task-sized work

The three highest-impact independent gaps warrant immediate follow-up tasks:

1. **Certify the approval workspace for mobile and WCAG 2.2 AA.**
2. **Build a tenant-scoped connector capability and consent registry.**
3. **Measure local AI-answer visibility with sourced GEO/AEO evidence.**

Metric snapshots, Daily Brief, Campaign, Ads, accounting, RLS, reporting, billing, and release safety already have task coverage and should be expanded or reconciled rather than duplicated.

The guarded MCP/agent capability plane is also genuinely uncovered, but it is intentionally not proposed as an immediate queue item. Its P3 prerequisites are P0 certification, P1 cost/event truth, and P2 connector/approval controls. Create that implementation task only when those gates are complete enough to make its acceptance criteria concrete.

## 11. Product and marketing scorecard

### Launch and trust

- 100% mandatory launch gates passing for the exact release.
- 0 cross-tenant read/write failures.
- 0 approval/export bypasses.
- 100% paid provider attempts accounted.
- 100% export packages with immutable approval receipt and manual-upload notice.

### Activation and workflow

- Brand Intelligence completion within 24 hours.
- Median signup/URL to confirmed Campaign plan.
- Median plan to first internal review.
- Median client review request to decision.
- Median client approval to owner-authorized export.
- Week-1 Campaign activation.

### Quality and UX

- Approval without edit and reopened-for-version-confusion rates.
- Mobile and desktop first-attempt task success.
- Time on review as an efficiency measure, not an engagement goal.
- Accessibility critical-flow completion parity.
- Support contacts about “who approves?” and “what happens next?”

### Outcomes

- Campaign outputs tied to durable source snapshots.
- Report values traceable to evidence.
- GEO/AEO controlled-query observation coverage and freshness.
- Daily Brief recommendation-to-relevant-decision rate.
- Beneficial actions completed, dismiss/snooze/not-useful rate, and recommendation accuracy.

### Economics

- Reconciled provider cost variance.
- p90 cost and sample count by operation/model/pipeline.
- Failed-provider spend.
- Gross margin per credit and negative-margin workspace rate.
- Cost-forecast error for queued and later agent-prepared work.

## 12. Explicit non-goals through P3

- No production switch of release `aa28026`.
- No launch-gate waiver for security, billing integrity, tenant isolation, or external approval.
- No queue rewrite to pg-boss.
- No destructive Campaign rewrite.
- No Batch-as-parent product concept.
- No direct Google/Meta publishing or platform spend.
- No automatic report/ad delivery by default.
- No separate Veo meter or automatic overage without governed policy change.
- No client-visible provider COGS, margin, internal prompts, or other-client data.
- No “live” or causal metric claim without sourced snapshots and attribution disclosure.
- No GEO guarantee or unsupported optimization trick.
- No open-ended MCP tools.
- No agent self-approval, scope expansion, budget change, or autonomous spending.
- No manipulative engagement mechanics.

## 13. Reversible decision points

| Decision | Default | Promotion evidence | Safe fallback |
|---|---|---|---|
| Campaign legacy reads | Dual-read | Reconciliation and zero-new-legacy-write period | Restore legacy read while preserving new data |
| Ads delivery | Export-only | Separate platform approval and direct-publish certification | Continue deterministic download |
| Provider fallback | Prevalidated only | Live validation, rate, quality, accounting | Disable operation or ask user to retry |
| Metric source | Snapshot adapter | Freshness and reconciliation SLA | Show unavailable/stale state |
| Daily Brief ranking | Rules-based | Offline and controlled online quality evidence | Revert to deterministic scoring |
| Connector permissions | Read-only | Per-capability security and product certification | Revoke write scope/disable connector |
| MCP exposure | Internal/read-only | Consent, egress, audit, and incident tests | Disable tool/server independently |
| Agent action | Suggest-only | Accurate simulation, budget, approval, and rollback evidence | Return to recommendation/diff only |
| Cross-client benchmarks | Disabled | Consent, privacy review, minimum cohort, anti-reidentification tests | Keep insights tenant-local |

## 14. 18-month to 10-year option map

These are architecture options, not committed features.

### 12–18 months: evidence-backed differentiation

- Local entity and citation-observation graph.
- Campaign-centered agency exception view.
- Client-safe outcome reports with source receipts.
- Read-first GA4/GSC/GBP and approved analytics connectors.
- Narrow internal MCP consumption for research and analytics.
- Agents that prepare Campaign plans and revisions but cannot self-approve.

### 18 months–4 years: conditional expansion

- Predictive local demand experiments by service/location, only with adequate coverage and calibrated uncertainty.
- Privacy-safe local benchmarks with consent and minimum cohorts.
- Additional customer-owned channels such as email/SMS after channel-specific consent, compliance, and deliverability certification.
- Narrow write connectors promoted capability by capability.
- Goal-based Campaign orchestration that remains budgeted and approval-gated.

### 4–10 years: preserve optionality, do not prebuild

- Machine-readable verified local-business evidence for agent-to-agent discovery.
- Composable interfaces that can adapt to a role/task without abandoning explicit approvals.
- More autonomous local Campaign operations only where each external effect is reversible, budgeted, and independently certified.

The architectural preparation required now is modest: immutable entities and events, stable capability contracts, source provenance, tenant isolation, and composable Campaign views. A generic “agent framework” or generative UI rewrite is not required today.

## 15. Final recommendation

Citefi should not attempt to win by matching every competitor’s module list or by adding broad autonomy before its current controls are certifiable.

The product should win on **governed local execution**:

- one Campaign;
- one frozen source of Brand truth;
- one visible approval chain;
- one auditable cost trail;
- one dated evidence layer;
- one clear next decision;
- and progressively granted, revocable automation.

The immediate leadership decision is simple:

> Keep production unchanged, finish P0 under the existing tasks, recertify one immutable release, and treat P1 data truth as the prerequisite for the P2 experience and P3 autonomy.

No roadmap item should be marketed as delivered until its stated acceptance evidence exists.