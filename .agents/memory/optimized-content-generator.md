---
name: Optimized content generator
description: The 3-point injection orchestrator that closes the AI learning loop; wiring rules, integration points, and the last remaining gap.
---

## Rule

The `OptimizedContentGenerator` (lib/optimized-content-generator.ts) is the keystone that closes the learning loop. All three injection points must be active together or the loop is open.

**Why:** Without the POST step (recording exact injected pattern IDs), the engagement labeler and review attribution have nothing to credit/blame. The PRE and DURING steps improve output quality but the system never learns from it.

## Three injection points

1. **PRE** — `generate()`: Wilson-ranked patterns + exemplars + avoid-list woven into the prompt before the model sees it.
2. **DURING** — `reviewAndRepairContent()`: critic runs immediately after generation; repairable defects (completeness, structure, humanness, channel) patched up to MAX_REPAIRS=2. Factuality defects flagged `<mark data-unverified>` — never re-rolled.
3. **POST** — `generate()`: exact pattern IDs assembled in step 1 written via `recordContentGeneration`. Identity must be preserved.

## How to apply

**For existing workers** (article pipeline, social pipeline) — use `reviewAndRepairContent()`:
- Article: wired at Stage 1.6, after Stage 1.5 reflexive validation, before Stage 2 GPT review.
- Social: wired at Stage 1.5, after Gemini generates caption, before GPT enhancement.
- Both fall through gracefully (wrapped in try/catch, non-blocking).
- Both respect `DISABLE_CRITIC_LOOP=true` env flag for speed testing.

**For future generators** — call `generate(teamId, contentType, brief)` directly and it closes all 3 points automatically. Requires `brief.contentId` (pre-allocated DB row) for `persistContent`.

## Critical constants

- `MAX_REPAIRS = 2` — cost control; more passes compound model API cost.
- `MAX_INJECTED_PATTERNS = 8` — prevents prompt bloat; >8 patterns conflict and the model follows none well.

## The last real gap: exemplar retrieval

`retrieveExemplars()` is a documented stub. This is the single highest-leverage remaining gap (architect's words). Wiring it produces "excellent, human" quality because the model imitates your proven past output.

What's needed:
1. Embedding store — embed the brief (topic + location + keyword).
2. Write path — after a piece is labeled `isSuccess=true` by the engagement labeler, embed and store it.
3. Similarity retrieval — vector-search for top 1-3 defect-free, high-engagement past pieces on a similar brief.
4. Cap total tokens — exemplars are expensive; truncate excerpts to ~500 words each.

## callModel routing

- Model name starts with `gemini` or `models/` → Google GenAI SDK (`genAI.models.generateContent`).
- Otherwise → `callOpenAI` wrapper (rate-limited, retried).
- Repair calls always use `GEMINI_FLASH_MODEL` (cheaper/faster for targeted corrections).
