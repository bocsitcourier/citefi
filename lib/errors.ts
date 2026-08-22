/**
 * lib/errors.ts — Pipeline error taxonomy
 *
 * Every AI/storage/provider failure is wrapped into a PipelineError with an
 * explicit disposition so the worker knows exactly what to do:
 *
 *   "retry"   — transient; BullMQ will retry with backoff
 *   "fatal"   — permanent; throw UnrecoverableError, skip all retries, alert
 *   "fallback"— same input will always fail; try a different strategy
 *   "degrade" — partial delivery possible (e.g. article without hero image)
 *
 * Fatal codes (MODEL_NOT_FOUND, AUTH_FAILURE, CONFIG_MISSING) burn every retry
 * attempt identically — the only fix is operator action. Throwing
 * UnrecoverableError from BullMQ skips remaining attempts immediately and moves
 * the job straight to the failed set for manual inspection.
 *
 * Rule: never construct a plain Error for a provider failure. Call
 * classifyError(caught, stage) and use its disposition.
 */

export type ErrorDisposition = "retry" | "fatal" | "fallback" | "degrade";

export type ErrorCode =
  // Fatal — operator must act
  | "MODEL_NOT_FOUND"        // 404 from a model API — dead ID, never self-heals
  | "AUTH_FAILURE"           // 401/403 — bad key or expired credential
  | "CONFIG_MISSING"         // required env var absent
  | "BUDGET_EXCEEDED"        // run accumulated cost >= ceiling; no retry would help
  // Retryable — transient
  | "RATE_LIMITED"           // 429 — honor Retry-After
  | "PROVIDER_ERROR"         // 5xx from provider
  | "TIMEOUT"                // network / generation timeout
  | "PARSE_ERROR"            // empty or malformed API response
  // Fallback / degrade
  | "CONTENT_POLICY_BLOCK"   // safety block — same input → same block, never retry
  | "TOKEN_LIMIT_EXCEEDED"   // prompt too long — try shorter version
  // Storage
  | "STORAGE_UPLOAD_FAILED"  // upload to DO Spaces / Replit Object Storage failed
  | "STORAGE_NOT_CONFIGURED" // bucket env var missing
  | "STALLED"                // watchdog detected no worker heartbeat; manual retry/recovery required
  // Generic
  | "GENERATION_ERROR";      // unclassified — treated as retryable

export const FATAL_CODES = new Set<ErrorCode>([
  "MODEL_NOT_FOUND",
  "AUTH_FAILURE",
  "CONFIG_MISSING",
  "STORAGE_NOT_CONFIGURED",
  "BUDGET_EXCEEDED",         // credits returned to user; no retry will succeed
]);

export class PipelineError extends Error {
  public readonly disposition: ErrorDisposition;

  constructor(
    message: string,
    public readonly code: ErrorCode,
    disposition: ErrorDisposition,
    public readonly stage: string,      // "enqueue" | "text_gen" | "image_gen" | "video_gen" | "upload" | "publish"
    public readonly provider?: string,  // "gemini" | "openai" | "veo" | "do_spaces" | "redis" | "db"
    public readonly cause?: unknown,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "PipelineError";
    this.disposition = FATAL_CODES.has(code) ? "fatal" : disposition;
  }

  toLogEntry() {
    return {
      code: this.code,
      disposition: this.disposition,
      stage: this.stage,
      provider: this.provider,
      retryAfterMs: this.retryAfterMs,
      message: this.message,
    };
  }
}

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * Classify a caught error into a typed PipelineError.
 *
 * @param err   - The caught value (any type).
 * @param stage - The pipeline stage where the error occurred.
 *                Use specific values: "text_gen" | "image_gen" | "video_gen" |
 *                "upload" | "publish" | "enqueue" | "startup".
 *                Stage is used to distinguish storage 404s from model 404s.
 * @param ctx   - Optional extra context. `provider` overrides auto-detection
 *                and is used to prevent storage provider 404s being classified
 *                as MODEL_NOT_FOUND.
 */
export function classifyError(
  err: unknown,
  stage: string = "unknown",
  ctx?: { provider?: string }
): PipelineError {
  if (err instanceof PipelineError) return err;

  const msg  = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  const prov  = ctx?.provider ?? detectProvider(lower);

  // ── Fatal (operator must act) ────────────────────────────────────────────
  if (lower.includes("401") || lower.includes("403") ||
      lower.includes("unauthorized") || lower.includes("forbidden") ||
      lower.includes("invalid api key") || lower.includes("authentication")) {
    return new PipelineError(msg, "AUTH_FAILURE", "fatal", stage, prov, err);
  }

  if (lower.includes("404") || lower.includes("not found") ||
      lower.includes("model not found") || lower.includes("not_found") ||
      lower.includes("is not found for api version") ||
      lower.includes("not supported for predictlongrunning")) {
    // A 404 at an upload/storage stage or from a storage provider is a missing
    // resource — retryable. Only a 404 from an AI model provider at a
    // generation stage means the model ID is dead (fatal MODEL_NOT_FOUND).
    const isStorageStage = stage === "upload" || stage === "publish" || stage === "storage";
    const isStorageProvider = prov === "do_spaces" || prov === "object_storage" || prov === "redis";
    const isAIProvider = prov === "gemini" || prov === "openai" || prov === "veo";
    if (isStorageStage || isStorageProvider) {
      return new PipelineError(msg, "STORAGE_UPLOAD_FAILED", "retry", stage, prov, err);
    }
    // Only a 404 from a recognized AI provider is a dead model ID (fatal).
    // Unknown-provider 404s are treated as retryable provider errors — being
    // wrong-but-retryable is cheaper than being wrong-but-fatal.
    if (isAIProvider) {
      return new PipelineError(msg, "MODEL_NOT_FOUND", "fatal", stage, prov, err);
    }
    return new PipelineError(msg, "PROVIDER_ERROR", "retry", stage, prov, err);
  }

  if (lower.includes("not configured") || lower.includes("missing env") ||
      lower.includes("api key not set") || lower.includes("no api key")) {
    return new PipelineError(msg, "CONFIG_MISSING", "fatal", stage, undefined, err);
  }

  // ── Fallback / degrade ───────────────────────────────────────────────────
  if (lower.includes("safety") || lower.includes("content_filter") ||
      lower.includes("content policy") || lower.includes("blocked_reason") ||
      lower.includes("finish_reason: safety") ||
      (lower.includes("blocked") && (prov === "gemini" || prov === "openai"))) {
    return new PipelineError(msg, "CONTENT_POLICY_BLOCK", "fallback", stage, prov, err);
  }

  if (lower.includes("token") && (lower.includes("limit") || lower.includes("exceed") || lower.includes("too long"))) {
    return new PipelineError(msg, "TOKEN_LIMIT_EXCEEDED", "degrade", stage, prov, err);
  }

  // ── Retryable ────────────────────────────────────────────────────────────
  if (lower.includes("429") || lower.includes("rate limit") ||
      lower.includes("resource_exhausted") || lower.includes("quota") ||
      lower.includes("too many requests")) {
    const retryAfterMs = extractRetryAfter(err);
    return new PipelineError(msg, "RATE_LIMITED", "retry", stage, prov, err, retryAfterMs);
  }

  if (lower.includes("500") || lower.includes("502") || lower.includes("503") ||
      lower.includes("service unavailable") || lower.includes("internal server error") ||
      lower.includes("bad gateway")) {
    return new PipelineError(msg, "PROVIDER_ERROR", "retry", stage, prov, err);
  }

  if (lower.includes("timeout") || lower.includes("timed out") ||
      lower.includes("econnreset") || lower.includes("etimedout") ||
      lower.includes("socket hang up") || lower.includes("aborted")) {
    return new PipelineError(msg, "TIMEOUT", "retry", stage, prov, err);
  }

  if (lower.includes("json") || lower.includes("parse") ||
      lower.includes("unexpected token") || lower.includes("empty response") ||
      lower.includes("no candidates") || lower.includes("empty candidates")) {
    return new PipelineError(msg, "PARSE_ERROR", "retry", stage, prov, err);
  }

  if (lower.includes("upload") || lower.includes("s3") || lower.includes("putobject") ||
      lower.includes("spaces") || lower.includes("object storage")) {
    return new PipelineError(msg, "STORAGE_UPLOAD_FAILED", "retry", stage, "do_spaces", err);
  }

  return new PipelineError(msg, "GENERATION_ERROR", "retry", stage, prov, err);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectProvider(lower: string): string | undefined {
  if (lower.includes("gemini") || lower.includes("googleapis")) return "gemini";
  if (lower.includes("openai") || lower.includes("chatgpt") || lower.includes("gpt-")) return "openai";
  if (lower.includes("veo")) return "veo";
  if (lower.includes("spaces") || lower.includes("s3") || lower.includes("putobject")) return "do_spaces";
  if (lower.includes("redis")) return "redis";
  if (lower.includes("neon") || lower.includes("postgres") || lower.includes("connection terminated")) return "db";
  return undefined;
}

function extractRetryAfter(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  if (typeof e.retryAfter === "number") return e.retryAfter * 1000;
  if (typeof e.retry_after === "number") return e.retry_after * 1000;
  if (e.headers && typeof e.headers === "object") {
    const h = e.headers as Record<string, string>;
    const ra = h["retry-after"] ?? h["Retry-After"];
    if (ra && !isNaN(parseInt(ra, 10))) return parseInt(ra, 10) * 1000;
  }
  return undefined;
}
