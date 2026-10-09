# Automatic model-upgrade remediation

## Scope and authorization

Local implementation and unpaid/offline verification of the architect's model-selection findings. No DigitalOcean deployment, paid generation canary, or historical receipt reconciliation was performed. The existing paid-QA stop remains in effect.

## Implemented

- Shared request-boundary selection for generation paths, with the same captured model used in the SDK request and its accounting receipt.
- Metadata catalog refresh, bounded last-good use, pagination validation, and readiness that does not silently declare failed catalogs healthy.
- Release-controlled contract approval and authoritative locked-price eligibility. Image/token dimensions have independent cost ceilings.
- Explicit pins do not override missing models, unapproved contracts, or unsupported Google operations.
- Model-specific rejection quarantines the ID for future operations; it does not replay a paid physical attempt.
- Model pricing is rechecked at operation boundaries.
- Admin-only, read-only diagnostics describe selected/blocked models and the worker's separately recorded state.
- Branded local pre-transport rejection distinguishes requests never sent from ambiguous network outcomes. A forged error code is not accepted as proof.
- Source inventory regression rejects literal provider models in request model assignments.

## Verification

- Combined offline model-policy/runtime/inventory, OpenAI/Gemini receipts, health, and readiness-drill suites: **78 passed, 0 failed**.
- Strict full-project TypeScript check using the existing incremental cache: **passed**.
- Owned-build IPC and build-root regression suites: **8 passed**.
- Running app: public landing-page screenshot rendered correctly; process liveness **200**; unauthenticated admin diagnostics **401**.
- Real provider catalog discovery and locked-rate lookup on worker startup selected **Gemini 3.5 Flash Lite** for critique, replacing the configured older critique baseline. This was metadata/pricing verification, not paid output certification.

## Build verification status

Initial native builds exposed owned-dependency locality and whole-project runtime-filesystem tracing problems. Both were corrected without removing fsync, ownership checks, retained staging dependencies, or the offline network guard.

**Final current-tree owned production build: PASS.** The unchanged `npm run build` completed native compilation, fresh strict TypeScript checking, page-data collection, and static-page generation against disposable PostgreSQL/Redis fixtures. Fixture cleanup completed with no active database connections. Actual app cache and original dependency files were preserved.

Do not treat this build pass or liveness as complete operational or paid-provider release certification.

## Deliberate remaining boundaries

- Newly discovered model families without request-contract certification and locked prices are reported as blocked. This is not a claim that every newest GPT/Gemini release is now eligible.
- Upgrade history is process-local; diagnostics include web and worker views, not a durable cross-restart audit.
- Paid acceptance tests and existing operational release checks remain separate. No publish/deploy approval is implied by these local results.
