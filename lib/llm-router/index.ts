/**
 * LLM Router — Multi-Provider Fallback with Privacy Enforcement
 *
 * Problem: Single-provider dependence on Gemini/OpenAI is a production risk
 * after free-tier shrinkage in 2025-2026. This router adds:
 *   - Per-provider in-memory quota tracking (RPD/TPD windows)
 *   - 429/5xx fallback ladder
 *   - Data-privacy flags: never route client VoC/review data through
 *     training-enabled free-tier providers
 *
 * Fallback ladder (default):
 *   1. Gemini Flash (primary — fast, cheap)
 *   2. OpenAI GPT (secondary)
 *   3. [Groq / Cloudflare — wired when secrets are available]
 *
 * Usage:
 *   import { llmRouter } from "@/lib/llm-router";
 *   const result = await llmRouter.complete({ prompt, containsClientData: true });
 */

export type PrivacyTier = "safe" | "training_enabled";

export interface ProviderConfig {
  id: string;
  name: string;
  privacyTier: PrivacyTier;
  /** Requests per day quota (0 = unlimited / paid) */
  dailyRequestQuota: number;
  /** Tokens per day quota (0 = unlimited) */
  dailyTokenQuota: number;
  /** Whether this provider is currently available (secret exists) */
  available: boolean;
}

export interface RouterRequest {
  prompt: string;
  systemPrompt?: string;
  /** If true, only "safe" privacy-tier providers are used */
  containsClientData?: boolean;
  /** Max tokens to generate */
  maxTokens?: number;
  /** Preferred provider ID (falls back if quota exhausted or error) */
  preferredProvider?: string;
}

export interface RouterResponse {
  text: string;
  providerUsed: string;
  tokensUsed?: number;
}

interface QuotaWindow {
  requests: number;
  tokens: number;
  windowStart: Date;
}

const PROVIDER_REGISTRY: ProviderConfig[] = [
  {
    id: "gemini-flash",
    name: "Gemini Flash",
    privacyTier: "safe", // Paid tier — does not train on data
    dailyRequestQuota: 0, // unlimited on paid
    dailyTokenQuota: 0,
    available: !!process.env.GEMINI_API_KEY,
  },
  {
    id: "openai-mini",
    name: "OpenAI GPT Mini",
    privacyTier: "safe", // API usage does not train models (opt-out default)
    dailyRequestQuota: 0,
    dailyTokenQuota: 0,
    available: !!process.env.OPENAI_API_KEY,
  },
];

const quotaStore = new Map<string, QuotaWindow>();

function getQuotaWindow(providerId: string): QuotaWindow {
  const now = new Date();
  let window = quotaStore.get(providerId);
  if (!window || now.getTime() - window.windowStart.getTime() > 86_400_000) {
    window = { requests: 0, tokens: 0, windowStart: now };
    quotaStore.set(providerId, window);
  }
  return window;
}

function isQuotaExhausted(provider: ProviderConfig): boolean {
  const window = getQuotaWindow(provider.id);
  if (provider.dailyRequestQuota > 0 && window.requests >= provider.dailyRequestQuota) return true;
  if (provider.dailyTokenQuota > 0 && window.tokens >= provider.dailyTokenQuota) return true;
  return false;
}

function recordUsage(providerId: string, tokens: number) {
  const window = getQuotaWindow(providerId);
  window.requests++;
  window.tokens += tokens;
}

/**
 * Select providers for a request, filtered by privacy and quota constraints.
 * Returns providers in priority order.
 */
export function selectProviders(req: RouterRequest): ProviderConfig[] {
  return PROVIDER_REGISTRY.filter((p) => {
    if (!p.available) return false;
    if (req.containsClientData && p.privacyTier === "training_enabled") return false;
    if (isQuotaExhausted(p)) return false;
    return true;
  });
}

/**
 * Main router entry point. Tries providers in fallback order.
 * Falls back on 429 or 5xx responses.
 */
export async function routedComplete(
  req: RouterRequest,
  callGemini: (prompt: string, system?: string, maxTokens?: number) => Promise<string>,
  callOpenAI: (prompt: string, system?: string, maxTokens?: number) => Promise<string>
): Promise<RouterResponse> {
  const providers = selectProviders(req);

  if (providers.length === 0) {
    throw new Error(
      req.containsClientData
        ? "No privacy-safe providers available. Never send client data through training-enabled free tiers."
        : "All LLM providers are unavailable or quota-exhausted."
    );
  }

  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      let text: string;

      if (provider.id === "gemini-flash") {
        text = await callGemini(req.prompt, req.systemPrompt, req.maxTokens);
      } else if (provider.id === "openai-mini") {
        text = await callOpenAI(req.prompt, req.systemPrompt, req.maxTokens);
      } else {
        continue;
      }

      const estimatedTokens = Math.ceil(text.length / 4);
      recordUsage(provider.id, estimatedTokens);

      return { text, providerUsed: provider.id, tokensUsed: estimatedTokens };
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const isRetryable = status === 429 || (status >= 500 && status < 600);
      lastError = err instanceof Error ? err : new Error(String(err));

      if (isRetryable) {
        console.warn(`[LLM Router] Provider ${provider.id} returned ${status} — falling back`);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("All providers failed");
}

/** Returns quota status for admin observability */
export function getProviderQuotaStatus(): Record<string, { requests: number; tokens: number; exhausted: boolean }> {
  const result: Record<string, { requests: number; tokens: number; exhausted: boolean }> = {};
  for (const p of PROVIDER_REGISTRY) {
    const window = getQuotaWindow(p.id);
    result[p.id] = {
      requests: window.requests,
      tokens: window.tokens,
      exhausted: isQuotaExhausted(p),
    };
  }
  return result;
}
