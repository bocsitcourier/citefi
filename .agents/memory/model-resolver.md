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
Full coverage as of last session — every AI generation path now uses resolver-validated tiers:
- lib/gemini.ts (title pool + article generation)
- lib/worker.ts (article + video workers)
- lib/article-reflexive.ts, audio-director.ts, smart-topic-research.ts, seo-regenerator.ts
- lib/gemini-social.ts (social post generation)
- lib/podcast-generator.ts (podcast script)
- lib/gemini-video-script-generator.ts (video script)
- lib/gemini-image-generator.ts (all 6 image generation call sites)
- lib/veo-video-generator.ts (Veo model call)
- app/api/health/route.ts uses getAllModels() + isResolverReady() (never getModel directly)
- All chatgpt-review/* files still use hard-coded "gpt-4.1-mini" literal — valid now, flagged for future migration to getModel("gptMini").

## Error taxonomy (lib/errors.ts)
classifyError(err, stage) + FATAL_CODES + UnrecoverableError wired into ALL four workers:
- Article worker: lib/worker.ts ~line 1522
- Social worker: lib/social-worker.ts
- Podcast worker: lib/podcast-worker.ts
- Video worker: lib/worker.ts ~line 3618
Fatal codes (MODEL_NOT_FOUND, AUTH_FAILURE, CONFIG_MISSING, STORAGE_NOT_CONFIGURED) skip remaining retries via UnrecoverableError.

## Credit release timing (G fix)
Article and social workers now only release the runId reservation when:
- classified.disposition === "fatal" (UnrecoverableError follows immediately), OR
- isFinalAttempt (job.attemptsMade + 1 >= job.opts.attempts)
This prevents releasing the reservation on attempt 1/3, which would leave a successful retry 2/3 unable to debit.
Podcast/video workers still release on every failure — defer until podcast-worker receives BullMQ Job object not just plain data.

## Seam 3 detection (NOT enforcement)
throttledGeminiRequest (lib/gemini.ts) and callOpenAI (lib/openai-client.ts) log [SEAM3] warnings when WORKER_PROCESS !== 'true'. 15 routes call AI directly from the web process — converting them to queued jobs is required before changing warnings to throws.
