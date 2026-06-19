---
name: T18 Journey Orchestrator Architecture
description: Key design decisions and constraints for the Journey Orchestrator + Cadence Optimizer feature.
---

# T18 Journey Orchestrator Architecture

**Why:** Needed cross-content coherence for multi-piece content sequences (article → social → podcast → video) plus cadence optimization that surfaces optimal publishing frequency as NBA recommendations.

## Tables Created
- `journey_templates` — prebuilt seed table (5 builtin); `steps_config` is JSONB array of step defs
- `journeys` — `terminalKpi` is NOT nullable (Gap L requirement); `locale`+`localeConfig` for locale-aware generation (Gap P)
- `journey_steps` — `status` FSM: pending→queued→generated→published; `scheduledFor` is trigger+dayOffset
- `cadence_performance` — written by nightly CohortMiningJob; `weeklyFrequency` + performance metrics

## Migration Convention
Migration DDL added to `migrations/0003_agency_client.sql` (all T-series SQL goes here, append-only).
Must also be applied to Neon DB via `scripts/migrate-t018-journeys.ts` (neon() template literals pattern).

## Journey Lifecycle
1. `POST /api/journeys` → creates journey in `draft` status with steps
2. `POST /api/journeys/[id]/trigger` → sets `triggered_at`, schedules all steps (scheduledFor = triggeredAt + dayOffset days), sets status=`active`
3. Journey scheduler (every 15 min) queries `pending` steps with `scheduledFor <= now`, enqueues generation jobs
4. Step status updated to `queued` before sending to pg-boss (prevents double-enqueue)
5. When all steps reach `generated`/`published`, journey auto-completes

## Cross-Content Coherence (lib/journey-context.ts)
- `getJourneyContext(journeyId, stepIndex)` fetches pillar article body (first 600 chars), persona, locale config
- Returns formatted `=== JOURNEY CONTEXT ===` prompt segment injected into every generation job
- `isPillarGenerated(journeyId)` gates non-pillar steps — step > 0 waits for step 0 to be generated

## Locale-Aware Generation (Gap P)
- `journey.locale` (e.g. "en-US", "es-MX") + `journey.localeConfig` (JSON: pricingReferences, regulatoryDisclaimers, localeSpecificClaims)
- Injected into journey context prompt segment when set

## Cadence Analysis
- Runs inside nightly CohortMiningJob after cohort phases
- Groups `content_performance_metrics` by team + contentType + week via raw SQL DATE_TRUNC
- Writes `cadence_performance` rows per (team, contentType, weeklyFrequency)
- If best frequency ≥40% better than average → inserts `cadence_optimization` insight into `cohort_insights`
- These surface as NBA recommendations on the Strategy tab

## Queue Names
- `journey-scheduler` added to `lib/queue.ts` ALL_QUEUES (index 17, total 17 queues)
- Scheduled with cron `*/15 * * * *`

**How to apply:** Any new journey feature should read lib/journey-context.ts first. The Journey scheduler worker is in lib/worker.ts after the cohort mining job. API routes follow the same `requireTeamMember` pattern as other team-scoped routes.
