---
name: Optimized content generator + orchestrator design
description: Durable architecture decisions for the critic-in-the-loop system wired across all content types
---

## Rule

The `OptimizedContentGenerator` (lib/optimized-content-generator.ts) is the keystone that closes the learning loop. All three injection points must be active together or the loop is open.

**Why:** Without the POST step (recording exact injected pattern IDs + variantId), the engagement labeler and review attribution have nothing to credit/blame. The PRE and DURING steps improve output quality but the system never learns from it.

## Three injection points

1. **PRE** — `generate()`: Wilson-ranked patterns + exemplars + avoid-list woven into the prompt before the model sees it.
2. **DURING** — `reviewAndRepairContent()`: critic runs immediately after generation; repairable defects (completeness, structure, humanness, channel) patched up to MAX_REPAIRS=2. Factuality defects flagged `<mark data-unverified>` — never re-rolled.
3. **POST** — exact pattern IDs + variantId written via `recordContentGenerated`. Identity must be preserved.

## How to apply

**For existing workers** (article, social, podcast, video) — use `reviewAndRepairContent()`:
- Article: wired at Stage 1.6, before Stage 2 GPT review.
- Social: wired at Stage 1.5 per-platform, before GPT enhancement.
- Podcast: wired after brand validation, before TTS.
- Video: wired after script generation, before Veo render.
- All fall through gracefully (wrapped in try/catch, non-blocking).
- All respect `DISABLE_CRITIC_LOOP=true` env flag for speed testing.

**Per-type shadow mode:** `ORCHESTRATOR_MODE_{CONTENTTYPE}=shadow` — logs before/after diff with `[ORCHESTRATOR_SHADOW]` prefix. Does NOT suppress repairs.

## requireJudge auto-default

- ARTICLE / SOCIAL: `requireJudge=true` — forces final GPT-4o-mini judge pass even on clean content.
- PODCAST / VIDEO: `requireJudge=false` — cheaper; cross-model scoring not justified for audio/script artifacts.

**Why:** The judge is what produces a meaningful qualityScore for Bayesian A/B attribution. Without it, clean ARTICLE/SOCIAL content would score 0, breaking Wilson attribution.

## variantId computation

Computed in `lib/learning-integration.ts` `recordContentGenerated()` — NOT in workers.
Algorithm: SHA-256(`${contentType}:${sortedPatternIds.join(',')}`) → UUID-like hex string.
Deterministic: sort is order-independent; same pattern set = same variantId.

## Exemplar retrieval (now wired)

`retrieveExemplars()` queries `content_performance_metrics` where `isSuccess=1 AND qualityScore>=80`, same team+contentType, top 3, joined to article/social content.
Falls back to `clientBrandProfiles.manualOverridesJson.seedExemplars`.
Logs `EXEMPLAR_SOURCE: historical|seed|none` for observability.

## Critical constants

- `MAX_REPAIRS = 2` — cost control; more passes compound model API cost.
- `MAX_INJECTED_PATTERNS = 8` — prevents prompt bloat; >8 patterns conflict and the model follows none well.
- `EXEMPLAR_MAX_CHARS = 600` — keeps exemplar injection prompt-lean.

## callModel routing

- Model name starts with `gemini` or `models/` → Google GenAI SDK.
- Otherwise → `callOpenAI` wrapper (rate-limited, retried).
- Repair calls always use `GEMINI_FLASH_MODEL` (cheaper/faster for targeted corrections).

## brandPolicyPack injection

`repair()` accepts optional `brandContext` (from `getClientBrandContext(teamId)` fetched in orchestrator).
Injected as "BRAND POLICY" block in every repair prompt so the model cannot weaken brand policy during a structural fix.
