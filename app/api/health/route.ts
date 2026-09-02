/**
 * /api/health — production preflight and operational health controls.
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { sql, and, eq, gte } from "drizzle-orm";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { systemDb as db } from "@/lib/db";
import { errorLogs } from "@/shared/schema";
import { getProviderCircuitStatus } from "@/lib/provider-circuit-breaker";
import { evaluateCanaryHealth, getLastCanaryResult } from "@/lib/canary-worker";
import { ALL_QUEUE_NAMES, getQueue, getRedisClientConfig, getRedisConnection } from "@/lib/queue";
import {
  collectHealth,
  healthThresholdsFromEnv,
  safeMessage,
  capabilityPolicyFromEnv,
  type StatusFile,
} from "@/lib/ops/health";
import { WORKER_HEARTBEAT_KEY } from "@/lib/ops/worker-heartbeat";
import { readWorkerReadiness } from "@/lib/ops/worker-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function transientRedisPing(): Promise<void> {
  const Redis = (await import("ioredis")).default;
  const { url, options } = getRedisClientConfig(undefined, {
    lazyConnect: true,
    connectTimeout: 3_000,
    commandTimeout: 3_000,
    maxRetriesPerRequest: 0,
  });
  const client = new Redis(url, options);
  client.on("error", () => {});
  try {
    await client.connect();
    await client.ping();
  } finally {
    client.disconnect();
  }
}

async function readStatusFile(path: string | undefined): Promise<StatusFile | null> {
  if (!path) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as StatusFile;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error("Configured status file is missing");
    if (error instanceof SyntaxError) throw new Error("Configured status file is invalid");
    throw new Error(safeMessage(error));
  }
}

async function checkStorage(): Promise<{ configured: boolean; providers: Record<string, boolean> }> {
  const configured = Boolean(
    process.env.DO_SPACES_KEY &&
    process.env.DO_SPACES_SECRET &&
    process.env.DO_SPACES_ENDPOINT &&
    process.env.DO_SPACES_BUCKET
  );
  const providers = {
    replitObjectStorage: Boolean(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID),
    doSpaces: configured,
  };
  if (!configured) return { configured: false, providers };
  const client = new S3Client({
    region: "us-east-1",
    endpoint: process.env.DO_SPACES_ENDPOINT,
    credentials: {
      accessKeyId: process.env.DO_SPACES_KEY!,
      secretAccessKey: process.env.DO_SPACES_SECRET!,
    },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: process.env.DO_SPACES_BUCKET! }));
  } finally {
    client.destroy();
  }
  return { configured: true, providers };
}

export async function GET(_request: NextRequest) {
  const queueNames = (process.env.HEALTH_QUEUE_NAMES ?? ALL_QUEUE_NAMES.join(","))
    .split(",").map((name) => name.trim()).filter(Boolean);

  const report = await collectHealth({
    database: async () => { await db.execute(sql`SELECT 1`); },
    redis: transientRedisPing,
    workerHeartbeat: () => getRedisConnection().get(WORKER_HEARTBEAT_KEY),
    workerReadiness: () => readWorkerReadiness(getRedisConnection()),
    queues: async () => Object.fromEntries(await Promise.all(queueNames.map(async (name) => {
      const queue = getQueue(name);
      const [waiting, active, failed] = await Promise.all([
        queue.getWaitingCount(), queue.getActiveCount(), queue.getFailedCount(),
      ]);
      return [name, { waiting, active, failed }] as const;
    }))),
    providerCircuits: getProviderCircuitStatus,
    canary: async () => {
      const result = await getLastCanaryResult();
      return { result: { ...result }, health: evaluateCanaryHealth(result) };
    },
    storage: checkStorage,
    models: async () => {
      const readiness = await readWorkerReadiness(getRedisConnection());
      return {
        ready: readiness?.modelsReady === true && readiness.failureReason == null,
        message: readiness?.failureReason ?? (readiness ? undefined : "Worker model resolution has not been recorded"),
        details: readiness ? { releaseVersion: readiness.releaseVersion } : undefined,
      };
    },
    backupStatus: () => readStatusFile(
      process.env.BACKUP_STATUS_FILE ??
      (process.env.NODE_ENV === "production" ? "/var/backups/citefi-db/status.json" : undefined)
    ),
    deploymentStatus: () => readStatusFile(
      process.env.DEPLOYMENT_STATUS_FILE ??
      (process.env.NODE_ENV === "production" ? `${process.cwd()}/.deploy/release-status.json` : undefined)
    ),
    recentCriticalErrors: async (since) => {
      const [row] = await db.select({ count: sql<number>`count(*)::int` })
        .from(errorLogs)
        .where(and(eq(errorLogs.severity, "critical"), gte(errorLogs.createdAt, since)));
      return Number(row?.count ?? 0);
    },
  }, healthThresholdsFromEnv(), capabilityPolicyFromEnv());

  const canary = report.services.canary as Record<string, unknown>;
  report.services.canary = {
    last_canary_run: canary.lastRunAt ?? null,
    last_canary_status: canary.canaryStatus ?? "never_run",
    last_canary_error: canary.error ?? canary.message ?? null,
    last_canary_stage: canary.stage ?? null,
    last_canary_provider: canary.provider ?? null,
    last_canary_duration_ms: canary.durationMs ?? null,
    ok: canary.ok,
    stale: canary.stale,
    health_reason: canary.health_reason,
    checkStatus: canary.status,
  };
  const storage = report.services.storage as Record<string, unknown>;
  report.services.storage = {
    ...((storage.providers as Record<string, boolean> | undefined) ?? {}),
    ok: storage.ok,
    status: storage.status,
    configured: storage.configured,
    latencyMs: storage.latencyMs,
    ...(storage.message ? { message: storage.message } : {}),
  };
  const providerCircuits = report.services.providerCircuits as Record<string, unknown>;
  report.services.providerCircuits = {
    ...((providerCircuits.details as Record<string, unknown> | undefined) ?? {}),
    ok: providerCircuits.ok,
    checkStatus: providerCircuits.status,
    ...(providerCircuits.message ? { message: providerCircuits.message } : {}),
  };
  // Keep the established top-level healthy/degraded contract while exposing
  // the more precise operational state separately.
  return NextResponse.json({
    ...report,
    status: report.status === "healthy" ? "healthy" : "degraded",
    operationalStatus: report.status,
  }, { status: report.ok ? 200 : 503 });
}