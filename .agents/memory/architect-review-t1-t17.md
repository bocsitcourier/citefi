---
name: Architect Review T1-T17 Findings
description: Key bugs found and fixed in architect review of all completed tasks (T1-T17) before starting T18.
---

# Architect Review — T1-T17 Fixes

**Why:** User requested full line-by-line review of all completed tasks before continuing T18 to ensure a clean foundation.

## Fixed Issues (by priority)

### CRITICAL
1. **IDOR in media route** (`app/api/media/[id]/route.ts`): GET/PATCH/DELETE only filtered by `articleAssets.id`, allowing any authenticated team member to read/edit/delete other teams' assets. Fixed by adding `eq(articleAssets.teamId, teamId)` to all three operations.
2. **Wrong field names in content update** (`app/api/content/[id]/update/route.ts`): was writing `htmlContent`/`title` but schema uses `finalHtmlContent`/`chosenTitle`. Fixed field mapping.

### HIGH
3. **Missing scheduled queues in ALL_QUEUES** (`lib/queue.ts`): Five scheduled queues (`video-orphan-sweeper`, `engagement-scoring`, `conversion-labeler`, `underperformer-archiving`, `cohort-mining`) were not registered at startup. pg-boss silently drops sends to unregistered queues.
4. **Persona enrichment join bug** (`lib/worker.ts` CohortMiningJob Phase 7): was filtering `articles.personaId` which doesn't exist — `personaId` is on `jobBatches`. Fixed by adding `innerJoin(jobBatches, eq(jobBatches.id, arts.batchId))` and filtering on `jobBatches.personaId`.
5. **Declare-winner missing guardrail check** (`app/api/decisioning/arms/[id]/declare-winner/route.ts`): promoted variant arms without checking for unresolved `guardrail_conflict` cohort insights. Added pre-check that returns 409 if active guardrail conflict exists for team/contentType within 30 days.
6. **Video never records contentPerformanceMetrics** (`workers/video-idea-worker.ts`): video generation succeeded but never called `recordContentGenerated`, breaking the Thompson Sampling learning loop for video. Fixed with non-fatal metrics call after success.
7. **Worker jobs swallow fatal errors** (`lib/worker.ts`): engagement-scoring, conversion-labeler, underperformer-archiving, cohort-mining all caught and logged fatal errors without rethrowing, so pg-boss marked failed runs as completed. Added `throw e` to all four job-level catch blocks.

### MEDIUM
8. **Strategy tab missing per-section empty states** (`app/learning/page.tsx`): NBA, primers, untapped sections silently disappeared when empty. Made all three always render with explicit empty state cards.
9. **NBA cards missing CTA links**: "Take Action" button was absent from NBA recommendation cards. Added route-backed CTA links mapped by `actionType`.
10. **Missing migration index** (`migrations/0003_agency_client.sql`): `content_performance_metrics.variant_arm_id` and compound `(team_id, content_type, variant_id)` index were missing. Added both with `IF NOT EXISTS`.

## Confirmed Working
- `wilsonLowerBound()` guards `trials === 0` — no division by zero risk
- `effectiveWeights()` falls back unknown content types to article weights
- `buildOptimizationContext()` resolves `terminalKpi` safely
- Brand context injection null-safe
- Strategy API authenticates correctly via `requireTeamMember(req)`
- All 17 auth tests pass after all fixes

## Still Tech Debt (not blocking)
- `as any` casts in worker.ts for T17 columns (tracked as #29)
- Schema `teamId` still nullable on some tables (risky migration, defer to dedicated task)
- Social `"social"` vs `"social_post"` naming: code already translates at API boundary (comment at worker.ts:2091), not a live bug
