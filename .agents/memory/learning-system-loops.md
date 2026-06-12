---
name: Learning system design
description: Key decisions and architecture for the AI Learning Center adaptive engine — what was broken, what was fixed, and the durable rules to follow.
---

## Durable rules

**Pattern selection (buildOptimizationContext)**
- Use Wilson lower-bound (95% CI) to rank patterns by `patternDimensionStats.wilsonScore` for each pattern's *governing dimension* (not always "engagement").
- PATTERN_DIMENSION map routes each patternType to its dimension: hook/cta/opening/pacing/hashtag/visual_style → engagement; tone → humanness; structure/format/composition/color/text → structure; eeat_signal → factuality.
- Epsilon-greedy: 15% of prompt slots go to randomly-selected *untested* patterns (trials < MIN_CONFIDENCE_SAMPLES=5) — cold-start fix.
- Never gate on `confidence >= threshold` in `buildOptimizationContext`. Seeds start at 0; threshold caused a circular deadlock.
- `priorityDimension?: Dimension` option lets callers override the PATTERN_DIMENSION map for a specific call.

**Why:** Seeded patterns were never surfaced (confidence=0 < threshold=60), and the single "engagement" dimension meant eeat_signal/tone patterns never accumulated data in their governing dimensions.

**PATTERN_DIMENSION must stay in sync across TWO files:**
- `LearningService.PATTERN_DIMENSION` in `lib/learning-service.ts`
- `EngagementScoringService.PATTERN_DIMENSION` in `lib/engagement-scoring-service.ts`
- Update both together when adding new pattern types.

**attributeEngagement — per-dimension writes**
- Looks up each pattern's type from `learningPatterns`, maps to its governing dimension, writes Wilson there.
- Batch-fetches all `patternDimensionStats` for affected patterns in one `inArray` query before the update loop.

**Why:** Previously always wrote to "engagement", so eeat_signal (factuality) and tone (humanness) patterns never accumulated data in their real dimensions.

**Negative constraints — use contentReviewService, not aiLearningLedger**
- `collectNegativeConstraints` calls `contentReviewService.getNegativeConstraints(teamId, contentType, 5)`.
- This pulls richer, dimension-aware defect strings from the `contentReviews` table.
- aiLearningLedger had only narrow error codes; contentReviews has full AI judge output.

**Pattern tracking (patternsUsed)**
- Workers must call `recordContentGenerated(teamId, contentType, contentId, patternsUsed, score)` from `lib/learning-integration.ts`.
- Never use `learningService.recordContentGeneration(teamId, hardcoded_id, ...)` directly — hardcoded agent IDs 1/2/3 break multi-tenant correctness.
- patternsUsed must never be []; it must be the real IDs from the OptimizationContext returned by getOptimizationContext.

**Engagement labeling**
- `EngagementScoringService.labelMaturedContent()` runs every 6h via pg-boss scheduler.
- Maturity gates: ARTICLE/PODCAST=336h, VIDEO=168h, SOCIAL=72h; MIN_COHORT=8.
- Low-reach items (views < MIN_REACH) get `successReason="insufficient_data"` in DB; isSuccess stays NULL.
- Composite score: percentile normalization + channel-specific weights.
- Writes `isSuccess` to `contentPerformanceMetrics`, then updates Wilson per pattern via `attributeEngagement`.

**Security**
- `addPattern()` must verify `agent.teamId === teamId` before inserting.
- `buildOptimizationContext` scopes pattern query by both agentId AND teamId.

**mine-corpus API**
- POST `/api/learning/mine-corpus` → `contentReviewService.mineCorpus(teamId, contentType, opts)`
- Accepts: `contentType` (required), `limit` (default 500), `judgeSampleRate` (default 0.2).
- Protected by `requireTeamMember`.

**New tables**
- `content_reviews` — one row per reviewed piece (deterministic + GPT judge scores)
- `pattern_dimension_stats` — per-(patternId, dimension) Wilson score ledger; unique index on (patternId, dimension)

**New services**
- `lib/content-review-service.ts` — 3-tier review + `mineCorpus()` backfill + `getNegativeConstraints()`
- `lib/engagement-scoring-service.ts` — auto-labeler with cohort maturity + per-dimension attribution
- `lib/learning-monitor-service.ts` — drift detection, leaderboards, snapshot API

**How to apply:**
- Whenever modifying the learning pipeline, verify patternsUsed IDs are non-empty.
- Any new content type worker must call `recordContentGenerated` (not the hardcoded version).
- The engagement scheduler queue "engagement-scoring" must be pre-created with `createQueue` before `schedule()` — pg-boss requires the queue to exist first.
- When adding a new pattern type, add it to BOTH PATTERN_DIMENSION maps (learning-service + engagement-scoring-service).
