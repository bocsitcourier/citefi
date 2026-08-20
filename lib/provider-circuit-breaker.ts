/**
 * Provider outage circuit breaker.
 *
 * A burst of provider-side 429/5xx responses is not an article-specific failure:
 * retrying every queued job only burns its retry budget. State is shared in Redis
 * so every worker sees the same open circuit and the probe scheduler can recover
 * the queues even after a process restart.
 */
import {
  ARTICLE_GENERATION_QUEUE,
  IMAGE_GENERATION_QUEUE,
  PODCAST_GENERATION_QUEUE,
  SOCIAL_POST_GENERATION_QUEUE,
  getQueue,
  getRedisConnection,
} from "./queue";
import { getTxDb } from "./db";
import { users } from "@/shared/schema";
import { and, eq } from "drizzle-orm";
import { createNotification } from "./notification-service";
import type { PipelineError } from "./errors";

const FAILURE_WINDOW_SECONDS = 120;
const FAILURE_THRESHOLD = 5;
const PROBE_INTERVAL_MS = 60_000;
const PROVIDERS = ["gemini", "openai"] as const;
type ProtectedProvider = (typeof PROVIDERS)[number];

export type ProviderCircuitState = {
  provider: ProtectedProvider;
  status: "closed" | "open";
  failures: number;
  openedAt?: string;
  queues: string[];
  lastProbeAt?: string;
  lastProbeError?: string;
};

const PROVIDER_QUEUES: Record<ProtectedProvider, string[]> = {
  gemini: [ARTICLE_GENERATION_QUEUE, IMAGE_GENERATION_QUEUE, SOCIAL_POST_GENERATION_QUEUE],
  openai: [ARTICLE_GENERATION_QUEUE, SOCIAL_POST_GENERATION_QUEUE, PODCAST_GENERATION_QUEUE],
};

const failureKey = (provider: ProtectedProvider) => `provider-circuit:${provider}:failures`;
const stateKey = (provider: ProtectedProvider) => `provider-circuit:${provider}:state`;

function protectedProvider(provider: string | undefined): provider is ProtectedProvider {
  return provider === "gemini" || provider === "openai";
}

async function readState(provider: ProtectedProvider): Promise<ProviderCircuitState | null> {
  const raw = await getRedisConnection().get(stateKey(provider));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProviderCircuitState;
  } catch {
    return null;
  }
}

async function writeState(state: ProviderCircuitState): Promise<void> {
  await getRedisConnection().set(stateKey(state.provider), JSON.stringify(state));
}

async function notifyAdmins(title: string, message: string): Promise<void> {
  const admins = await getTxDb()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.accountStatus, "active")));
  await Promise.allSettled(admins.map((admin) => createNotification({
    userId: admin.id,
    type: "error",
    category: "system",
    title,
    message,
    entityType: "system",
    actionUrl: "/admin/errors",
  })));
}

async function pauseQueues(names: string[]): Promise<void> {
  await Promise.allSettled(names.map((name) => getQueue(name).pause()));
}

async function resumeQueues(names: string[]): Promise<void> {
  // The spend breaker owns a broader pause; provider recovery must never resume
  // a queue while platform spending is still over its safe threshold.
  const { getBreakerStatus } = await import("./spend-breaker");
  if (await getBreakerStatus() !== "ok") return;
  const circuits = await getProviderCircuitStatus();
  const blockedByAnotherProvider = new Set(
    Object.values(circuits)
      .filter((state) => state.status === "open")
      .flatMap((state) => state.queues),
  );
  await Promise.allSettled(
    names.filter((name) => !blockedByAnotherProvider.has(name)).map((name) => getQueue(name).resume()),
  );
}

/** Records a retryable provider failure and opens the provider's circuit at 5/2min. */
export async function recordProviderFailure(queueName: string, error: PipelineError): Promise<void> {
  if (!protectedProvider(error.provider) ||
      (error.code !== "PROVIDER_ERROR" && error.code !== "RATE_LIMITED")) return;

  const provider = error.provider;
  const redis = getRedisConnection();
  const failures = await redis.incr(failureKey(provider));
  if (failures === 1) await redis.expire(failureKey(provider), FAILURE_WINDOW_SECONDS);
  if (failures < FAILURE_THRESHOLD) return;

  const existing = await readState(provider);
  if (existing?.status === "open") return;

  const queues = PROVIDER_QUEUES[provider];
  const state: ProviderCircuitState = {
    provider,
    status: "open",
    failures,
    openedAt: new Date().toISOString(),
    queues,
  };
  await writeState(state);
  await pauseQueues(queues);
  console.error(`🚨 [provider-circuit] ${provider} opened after ${failures} failures; paused ${queues.join(", ")}`);
  await notifyAdmins(
    `${provider === "gemini" ? "Gemini" : "OpenAI"} outage detected`,
    `${failures} provider failures occurred within two minutes. Affected generation queues are paused and will automatically resume after a successful health probe.`,
  ).catch((err) => console.warn("[provider-circuit] admin notification failed:", err));
}

async function probe(provider: ProtectedProvider): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    if (provider === "gemini") {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return { ok: false, error: "GEMINI_API_KEY is not configured" };
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, { signal: controller.signal });
      return response.ok ? { ok: true } : { ok: false, error: `ListModels returned HTTP ${response.status}` };
    }
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, error: "OPENAI_API_KEY is not configured" };
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    return response.ok ? { ok: true } : { ok: false, error: `/v1/models returned HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Probes every open provider circuit; a successful probe closes and resumes it. */
export async function probeOpenProviderCircuits(): Promise<void> {
  for (const provider of PROVIDERS) {
    const state = await readState(provider);
    if (state?.status !== "open") continue;

    const result = await probe(provider);
    if (!result.ok) {
      await writeState({ ...state, lastProbeAt: new Date().toISOString(), lastProbeError: result.error });
      console.warn(`⚠️ [provider-circuit] ${provider} probe still failing: ${result.error}`);
      continue;
    }

    // Clear this circuit before checking whether any *other* provider still
    // owns the queue pause (articles use both Gemini and OpenAI).
    await getRedisConnection().del(stateKey(provider), failureKey(provider));
    await resumeQueues(state.queues);
    console.log(`✅ [provider-circuit] ${provider} recovered; resumed ${state.queues.join(", ")}`);
    await notifyAdmins(
      `${provider === "gemini" ? "Gemini" : "OpenAI"} recovered`,
      "The provider health check passed and affected generation queues have resumed.",
    ).catch(() => {});
  }
}

export async function getProviderCircuitStatus(): Promise<Record<ProtectedProvider, ProviderCircuitState>> {
  const result = {} as Record<ProtectedProvider, ProviderCircuitState>;
  for (const provider of PROVIDERS) {
    const state = await readState(provider);
    result[provider] = state ?? {
      provider,
      status: "closed",
      failures: Number(await getRedisConnection().get(failureKey(provider)) ?? 0),
      queues: PROVIDER_QUEUES[provider],
    };
  }
  return result;
}

export function startProviderCircuitScheduler(): void {
  const run = () => probeOpenProviderCircuits().catch((err) =>
    console.warn("[provider-circuit] probe scheduler failed:", err instanceof Error ? err.message : err)
  );
  run();
  const timer = setInterval(run, PROBE_INTERVAL_MS);
  timer.unref();
  console.log("⏱️ Provider circuit probe scheduler registered (every 60s)");
}