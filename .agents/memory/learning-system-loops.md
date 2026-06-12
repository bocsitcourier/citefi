---
name: Learning system design
description: Key decisions and architecture for the AI Learning Center adaptive engine — what was broken, what was fixed, and the durable rules to follow.
---

## Durable rules

**Pattern selection (buildOptimizationContext)**
- Use Wilson lower-bound (95% CI) to rank patterns by `patternDimensionStats.wilsonScore` for the "engagement" dimension.
- Epsilon-greedy: 15% of prompt slots go to randomly-selected *untested* patterns (no Wilson row yet) — this is the cold-start fix.
- Never gate on `confidence >= threshold` in `buildOptimizationContext`. The confidence threshold caused a deadlock: seeds start at 0, threshold was 60.
- Negative constraints are collected from `aiLearningLedger` and injected into every prompt.

**Why:** Seeded patterns were never surfaced (confidence=0 < threshold=60), so EMA/Wilson never received updates, so confidence never rose — circular deadlock. Epsilon-greedy breaks this by always exploring untested patterns.

**Pattern tracking (patternsUsed)**
- Workers must call `recordContentGenerated(teamId, contentType, contentId, patternsUsed, score)` from `lib/learning-integration.ts`.
- Never use `learningService.recordContentGeneration(teamId, hardcoded_id, ...)` directly — hardcoded agent IDs 1/2/3 break multi-tenant correctness.
- Remove confidence gates from `learning-integration.ts` `getPromptEnhancement()` — ALL patterns returned by context must be tracked in `patternsUsed`.

**Why:** The patternsUsed array was always [] because the confidence gate (≥60 / ≥40) blocked every seeded pattern, meaning EMA/Wilson updates never fired.

**Engagement labeling**
- `EngagementScoringService.labelMaturedContent()` runs every 6h via pg-boss scheduler.
- Maturity gates: ARTICLE/PODCAST=336h, VIDEO=168h, SOCIAL=72h; MIN_COHORT=8.
- Composite score uses percentile normalization + channel-specific weights, not raw values.
- Writes `isSuccess` to `contentPerformanceMetrics`, then attributes Wilson per pattern via `patternDimensionStats`.

**Why:** `isSuccess` was never set, so the EMA update path (`recordFeedback`) had nothing to learn from.

**Security**
- `addPattern()` must verify `agent.teamId === teamId` before inserting. Without this check, cross-team prompt injection is possible.

**New tables (added in this session)**
- `content_reviews` — one row per reviewed piece (deterministic + GPT judge scores)
- `pattern_dimension_stats` — per-(patternId, dimension) Wilson score ledger; unique index on (patternId, dimension)

**New services**
- `lib/content-review-service.ts` — 3-tier review + `mineCorpus()` backfill
- `lib/engagement-scoring-service.ts` — auto-labeler with cohort maturity
- `lib/learning-monitor-service.ts` — drift detection, leaderboards, snapshot API

**How to apply:**
- Whenever modifying the learning pipeline, verify patternsUsed IDs are non-empty before calling recordContentGenerated.
- Any new content type worker must call `recordContentGenerated` (not the hardcoded version).
- The engagement scheduler queue "engagement-scoring" must be pre-created with `createQueue` before `schedule()` — pg-boss requires the queue to exist first.
