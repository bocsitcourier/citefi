/**
 * /api/health — production preflight health check
 *
 * Checks: DB connectivity, Redis PING, model resolver status.
 * Returns 200 when all critical services are up, 503 otherwise.
 * Suitable as a target for external uptime monitors (UptimeRobot, etc.).
 *
 * Use /api/health?full=1 for the detailed breakdown (slower — does live
 * model-list validation); omit for the fast cache-based check.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getAllModels, getGeminiValidationStatus, isResolverReady } from "@/lib/model-resolver";
import { getProviderCircuitStatus } from "@/lib/provider-circuit-breaker";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true, latencyMs: Date.now() - t };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t, error: (err as Error).message.slice(0, 120) };
  }
}

async function checkRedis(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t = Date.now();
  try {
    const Redis = (await import("ioredis")).default;
    const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    const client = new Redis(url, { lazyConnect: true, connectTimeout: 3000, commandTimeout: 3000, maxRetriesPerRequest: 0 });
    await client.connect();
    await client.ping();
    await client.quit();
    return { ok: true, latencyMs: Date.now() - t };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t, error: (err as Error).message.slice(0, 120) };
  }
}

function checkModels(): { ok: boolean; ready: boolean; models: Record<string, string>; warnings: string[] } {
  const ready = isResolverReady();
  const models = getAllModels();
  const warnings: string[] = [];
  if (!ready) warnings.push("Model resolver has not run — showing ai-config defaults, not live-validated values");
  const knownShutdowns: Record<string, string> = {
    "gemini-2.5-pro": "2026-10-16",
  };
  for (const [tier, id] of Object.entries(models)) {
    if (knownShutdowns[id]) warnings.push(`${tier} (${id}) shuts down ${knownShutdowns[id]}`);
  }
  const gemini = getGeminiValidationStatus();
  if (!gemini.checked) warnings.push("Gemini model validation has not run yet");
  else if (!gemini.available) warnings.push(`Gemini model validation unavailable: ${gemini.error ?? "unknown error"}`);
  else if (gemini.unrecognizedModels.length > 0) {
    warnings.push(`Unrecognized Gemini model IDs: ${gemini.unrecognizedModels.join(", ")}`);
  }
  return { ok: gemini.available && gemini.unrecognizedModels.length === 0, ready, models, warnings };
}

export async function GET(request: NextRequest) {
  const full = request.nextUrl.searchParams.get("full") === "1";

  const [dbResult, redisResult, providerCircuits] = await Promise.all([
    checkDatabase(),
    full ? checkRedis() : Promise.resolve({ ok: true, latencyMs: 0, note: "skipped (use ?full=1)" }),
    getProviderCircuitStatus().catch((err) => ({ error: (err as Error).message })),
  ]);
  const modelResult = checkModels();

  const allOk = dbResult.ok && redisResult.ok;
  const status = allOk ? 200 : 503;

  return NextResponse.json(
    {
      status: allOk ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      services: {
        database: dbResult,
        redis: redisResult,
        models: modelResult,
        storage: {
          replitObjectStorage: !!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID,
          doSpaces: !!process.env.DO_SPACES_BUCKET,
        },
        providerCircuits,
      },
    },
    { status }
  );
}
