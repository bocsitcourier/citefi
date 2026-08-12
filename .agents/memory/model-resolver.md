---
name: Model resolver (Level 2 startup validation)
description: How AI model IDs are validated and resolved at worker startup; fallback chain design; which files use RESOLVED_MODELS.
---

## Rule
All runtime AI API calls must use `getModel(tier)` (lib/model-resolver.ts). Never import static constants from lib/ai-config.ts or destructure RESOLVED_MODELS at module scope. The resolver validates every configured model ID against the live API at worker startup and falls back through a verified chain automatically.

**Why:** The content pipeline was silently broken for months because model IDs drifted out of sync with what the APIs actually serve. `getModel()` throws a fatal PipelineError if called before `validateAndResolveModels()` runs — mis-ordered boots surface immediately with a stack trace instead of returning undefined or a stale import-time capture.

## How to apply
- Worker startup (`server/worker-process.ts`): call `await validateAndResolveModels()` BEFORE `registerWorkers()`.
- Adding a new AI call in any lib/*.ts file:
  ```ts
  import { getModel } from "./model-resolver";
  model: getModel("geminiFlash")   // not GEMINI_FLASH_MODEL, not RESOLVED_MODELS.x
  ```
- Health/status checks: use `getAllModels()` (returns defaults if resolver not run) and `isResolverReady()`.
- Adding a new model tier: add a constant to ai-config.ts, add to DEFAULTS map in model-resolver.ts, add fallback chain to GEMINI_CHAINS or OPENAI_CHAINS, mark CRITICAL_TIERS if the tier must never be missing.
- Mid-flight 404 from a model call: call `reResolveAfterModelNotFound(tier)` to re-run the resolver without a restart.

## Fallback chains (verified 2026-08)
| Tier | Chain |
|------|-------|
| geminiFlash / geminiArticle | gemini-3.5-flash → gemini-2.5-flash → gemini-2.5-flash-preview-04-17 |
| geminiPro | gemini-3.1-pro-preview → gemini-2.5-pro → gemini-3.5-flash |
| geminiCritique | gemini-2.5-flash-lite → gemini-3.5-flash-lite → gemini-3.5-flash |
| geminiImage | gemini-2.5-flash-image → gemini-3.1-flash-image → gemini-2.5-flash |
| gptMini / gptReview / hyperlink | gpt-4.1-mini → gpt-4.1-mini-2025-04-14 → gpt-4o-mini |
| gptAdvanced | gpt-4.1 → gpt-4.1-2025-04-14 → gpt-4o |
| veoVideo | not validated (separate Veo endpoint); configured value used as-is |

## Known shutdown dates to keep updated
- gemini-2.5-pro: 2026-10-16 → replaced by gemini-3.1-pro-preview (already in chain)
- Emit via KNOWN_SHUTDOWNS map in model-resolver.ts so the warning fires at startup even before the shutdown date.

## Files that call getModel()
- lib/gemini.ts (title pool + article generation)
- lib/worker.ts (EU AI Act disclosure model recording)
- lib/article-reflexive.ts, audio-director.ts, smart-topic-research.ts, seo-regenerator.ts
- app/api/health/route.ts uses getAllModels() + isResolverReady() (never getModel directly)
- All chatgpt-review/* files still use hard-coded "gpt-4.1-mini" literal — valid now, flagged for future migration to getModel("gptMini").
