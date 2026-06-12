---
name: Learning system design
description: Durable rules and architecture decisions for the AI Learning Center adaptive engine.
---

## Durable rules

**PATTERN_DIMENSION — single source of truth**
- Lives in `lib/pattern-dimension-map.ts`. Import it; never duplicate it.
- Current map: hook/cta/opening/pacing/hashtag/visual_style → engagement; tone → humanness; structure/format/composition/color/text → structure; eeat_signal → factuality.
- Adding a new pattern type means editing only this one file.

**Why:** Duplicated maps in LearningService and EngagementScoringService diverged silently. Centralized module prevents drift.

**Pattern selection (buildOptimizationContext)**
- Fetches all dimensions in one `inArray` query; routes each pattern through PATTERN_DIMENSION.
- Epsilon-greedy (ε=0.15): exploit proven (trials ≥ 5) patterns by Wilson score, explore untested randomly.
- Cold start: if no proven patterns exist, use all patterns as-is (never return empty context).
- `priorityDimension?: Dimension` option overrides the PATTERN_DIMENSION lookup for a specific call.
- Never gate on confidence threshold — this caused a circular deadlock (confidence=0 blocked seeded patterns from ever being used, so they never got trials, so confidence never rose).

**Engagement attribution (attributeEngagement)**
- Looks up each pattern's type from learningPatterns, routes to its governing dimension via PATTERN_DIMENSION.
- Single batch fetch of patternDimensionStats for all patternIds, then upsert per pattern.

**updatePatternDimension — atomic upsert**
- Uses INSERT ... ON CONFLICT DO UPDATE (unique index on patternId + dimension).
- After upsert, reads back actual successes/trials and recomputes Wilson for accuracy.
- Never use read-then-insert/update pattern — concurrent writers lose increments.

**Negative constraints — via contentReviewService, not raw ledger**
- `collectNegativeConstraints` calls `contentReviewService.getNegativeConstraints()`.
- This queries `aiLearningLedger` which is populated by `mineCorpus → recordCorpusDefects`.
- Cold start before any corpus mining: returns [] (safe, expected).

**mineCorpus — content-type-specific sources**
- SOCIAL → `socialPosts` (status=READY) + first READY variant caption from `socialPostVariants`
- VIDEO → `videoIdeas` (status=READY) + shortIdea + expandedConceptJson
- ARTICLE / PODCAST → `articles` table (finalHtmlContent)

**recordContentGeneration — PODCAST uses articleId**
- ARTICLE and PODCAST both set `articleId` in contentPerformanceMetrics.
- SOCIAL → socialPostId, VIDEO → videoIdeaId.
- Metrics row was orphaned for PODCAST before this fix.

**Podcast learning loop**
- `podcast-worker.ts` calls `recordContentGenerated(PODCAST, articleId, [], 0)` after successful generation.
- patternsUsed=[] because podcast script generator is not yet integrated with getPromptEnhancement (follow-up item).
- This creates the contentPerformanceMetrics row so the engagement scorer can label it.

**Engagement labeling**
- `EngagementScoringService.labelMaturedContent()` runs every 6h via pg-boss.
- Maturity gates: ARTICLE/PODCAST=336h, VIDEO=168h, SOCIAL=72h; MIN_COHORT=8.
- Low-reach items get `successReason="insufficient_data"`; isSuccess stays NULL.

**Security**
- `addPattern()` verifies `agent.teamId === teamId`.
- `buildOptimizationContext` scopes pattern query by both agentId AND teamId.

**How to apply when extending:**
- New pattern type → add to `lib/pattern-dimension-map.ts` only.
- New content type worker → call `recordContentGenerated` after success, and create a contentPerformanceMetrics entry.
- New content type in mineCorpus → add a branch in the if/else chain with correct table + content extraction.
- pg-boss scheduler queue must be pre-created with `createQueue` before `schedule()`.
