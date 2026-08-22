### Requirements Inventory

| Category | Requirement / Goal | Status | Line Ref(s) |
| :--- | :--- | :--- | :--- |
| **Product Positioning & Core Workflow** | Position as "Local Marketing Campaign Engine" (URL-to-campaign); prioritize workflow over generic AI writing. | [R] | [L7], [L191], [L193] |
| **Campaign/Agency/Client UX** | Simplify navigation; implement "Campaign" as parent model; support agency client portals/rebilling. | [R] | [L67], [L195], [L208] |
| **Security/Auth/Multitenancy** | Fix token exposure (HttpOnly cookies); implement RLS for tenant isolation; audit admin route guards. | [S] | [L46], [L406], [L410] |
| **Content and AI Pipelines** | Route content tasks by model (Gemini/GPT/DeepSeek); use shared policy/quality middleware. | [R] | [L198], [L576] |
| **Brand Intelligence/Learning** | Brand Intelligence as first-run onboarding; canonical source of truth for all campaign generation. | [R] | [L63], [L196] |
| **Ads and Connections** | Ads Lab (export-only MVP); OAuth consent wizard; early Google/Meta API application. | [R] | [L65], [L133], [L662] |
| **Daily Brief/Reporting** | Daily "Citefi Coach" prioritizing high-leverage marketing actions; white-label monthly reports. | [R] | [L668], [L677] |
| **Billing/Credits/Margins** | Two-bucket credit ledger (reserve/debit/release); implement margin dashboard and provider usage tracking. | [S] | [L34], [L342], [L556] |
| **Infrastructure/Observability** | Multi-environment (Dev/Staging/Prod); worker process separation; Sentry/uptime monitoring. | [R] | [L349], [L353], [L361] |
| **Data Model** | Migrate to Campaign-centric schema; add provider_usage_events for cost tracking; standardize workspace vs. team vocabulary. | [R] | [L195], [L311], [L341] |
| **Testing/Launch Criteria** | Enable TypeScript build enforcement; CI pipeline with Playwright smoke tests; regression suite for security/billing. | [S] | [L50], [L236], [L861] |

***

**Acceptance Criteria & Explicit Roadmap Targets**
*   **Security (P0):** No routes return access tokens in body; admin API restricted to `requireAdmin` [L226], [L231].
*   **CI/CD (P0):** Fail production build on type errors; GitHub Actions for linting/tests [L236], [L241].
*   **Campaigns (P1):** Backfill existing batches into campaigns with dual-read compatibility window [L341], [L267].
*   **Ads (P1):** Export-only MVP (Google RSA, Meta pack, UTM, policy pre-check) [L272].
*   **API Approvals (Day 0):** Begin Google/Meta application process immediately due to multi-week lead times [L211], [L414].
*   **Margin (P2):** Gross margin per credit >75%; negative-margin workspaces <2% [L837], [L840].

*Note: Document was truncated during internal processing; status keys ([S], [R], [A]) are preserved based on the provided blueprint.*