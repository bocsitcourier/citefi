import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { registerWorkers } from "../lib/worker";
import { validateAndResolveModels } from "../lib/model-resolver";
import { validateApprovalTokenSecret } from "../lib/approval-token";
import { closeQueues, getRedisConnection } from "../lib/queue";
import { startWorkerHeartbeat, stopWorkerHeartbeat } from "../lib/ops/worker-heartbeat";
import { closePipelineWorkers } from "../lib/pipeline-worker";
import { startJobMonitor, stopJobMonitor } from "./job-monitor";
import { ensurePublishingSecretsReady } from "../lib/publishing";
import { systemDb } from "../lib/db";
import { runWithSystemContext } from "../lib/tenant-context";
import { processDiagnosticLog } from "../lib/process-diagnostics";
import {
  beginWorkerReadiness,
  clearWorkerReadiness,
  failWorkerReadiness,
  markWorkerModelsReady,
  markWorkerRegistration,
  markWorkerScheduler,
  isDevelopmentCanaryOnlyUnready,
} from "../lib/ops/worker-readiness";

config({ path: '.env.local', override: true });

// ── Fatal boundary telemetry ──────────────────────────────────────────────────
// Capture best-effort durable evidence, then preserve Node's fatal semantics.
// Continuing after an uncaught exception can leave worker state corrupted;
// BullMQ recovers unfinished jobs when the supervisor restarts this process.
process.on("uncaughtException", (err: Error) => {
  const msg = err.message ?? "";
  const redis = getRedisConnection();
  void stopWorkerHeartbeat(redis).then(() => failWorkerReadiness(redis, err)).catch(() => {});
  processDiagnosticLog("error", "❌ [worker] Uncaught exception — logging before exit:", err);
  process.exitCode = 1;
  import("../lib/error-logger").then(({ logError }) => {
    runWithSystemContext("worker uncaught exception audit logging", () =>
      logError({
        errorType: "SYSTEM",
        errorMessage: `[worker:uncaughtException] ${msg}`,
        stackTrace: err.stack,
        severity: "critical",
        component: "worker-process",
        context: { name: err.name },
      })
    ).finally(() => process.exit(1));
  }).catch(() => process.exit(1));
  setTimeout(() => process.exit(1), 2_000).unref();
});

process.on("unhandledRejection", (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  const msg = err.message;
  const redis = getRedisConnection();
  void stopWorkerHeartbeat(redis).then(() => failWorkerReadiness(redis, err)).catch(() => {});
  processDiagnosticLog("error", "❌ [worker] Unhandled promise rejection — logging before exit:", err);
  process.exitCode = 1;
  import("../lib/error-logger").then(({ logError }) => {
    runWithSystemContext("worker unhandled rejection audit logging", () =>
      logError({
        errorType: "SYSTEM",
        errorMessage: `[worker:unhandledRejection] ${msg}`,
        stackTrace: err.stack,
        severity: "error",
        component: "worker-process",
      })
    ).finally(() => process.exit(1));
  }).catch(() => process.exit(1));
  setTimeout(() => process.exit(1), 2_000).unref();
});

// ── Neon keep-alive pinger ────────────────────────────────────────────────────
// Neon suspends compute after ~5 minutes of idle.  Article generation takes up
// to 10 minutes, so without this ping the pg pool connections die mid-flight.
// Sends a lightweight HTTP query every 4 minutes to keep compute awake.
// Uses the stateless Neon HTTP driver so the ping itself never has socket issues.
const NEON_PING_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

function startNeonKeepAlive() {
  keepAliveTimer = setInterval(async () => {
    try {
      await systemDb.execute(sql`SELECT 1`);
    } catch (e) {
      processDiagnosticLog("warn", "⚠️ [worker] Neon keep-alive ping failed (non-fatal):", e);
    }
  }, NEON_PING_INTERVAL_MS);
  // Don't let the timer block process shutdown
  keepAliveTimer.unref();
}

async function startWorkers() {
  const redis = getRedisConnection();
  try {
    processDiagnosticLog("log", "🔄 Worker process starting...");
    await beginWorkerReadiness(redis);

    // Start keep-alive before any long-running work
    startNeonKeepAlive();

    // Replay DB-outage telemetry before accepting jobs. Event UUIDs make this
    // safe after a crash at any point in replay.
    const { replayTelemetrySpool } = await import("../lib/incident-intelligence/service");
    const spoolReplay = await replayTelemetrySpool();
    if (spoolReplay.replayed > 0 || spoolReplay.remaining > 0) {
      processDiagnosticLog("log", `📥 Telemetry spool replayed=${spoolReplay.replayed} remaining=${spoolReplay.remaining}`);
    }

    // ── Storage configuration check ───────────────────────────────────────────
    // Non-fatal: other workers (articles, social posts, etc.) don't need storage.
    // Video generation jobs will fail fast with STORAGE_NOT_CONFIGURED instead of
    // silently burning Veo quota and leaving posts stuck at GENERATING.
    const { isStorageConfigured } = await import("../lib/storage");
    if (!isStorageConfigured) {
      processDiagnosticLog("warn",
        "⚠️ [startup] DO Spaces storage not configured — video generation jobs will " +
        "be rejected immediately with STORAGE_NOT_CONFIGURED. " +
        "Set DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_ENDPOINT, and DO_SPACES_BUCKET."
      );
    } else {
      processDiagnosticLog("log", "✅ [startup] Storage (DO Spaces) is configured — video generation enabled.");
    }

    // Validate publishing secrets before starting workers
    await runWithSystemContext(
      "worker bootstrap publishing secret validation",
      () => ensurePublishingSecretsReady()
    );

    // Assert APPROVAL_TOKEN_SECRET is set (required in production).
    // Fails fast here so a missing env var surfaces at startup, not when the
    // first admin approval email goes out.
    validateApprovalTokenSecret();

    // Validate AI model IDs against live APIs; fall back through chains if any
    // are retired. Throws if a critical tier (flash, pro, gpt-mini) has no live model.
    await validateAndResolveModels();
    await markWorkerModelsReady(redis);
    
    // Register all BullMQ workers
    await registerWorkers();
    await markWorkerRegistration(redis, "pipeline-workers");
    
    // Start job monitoring for stuck job detection
    await startJobMonitor();
    await markWorkerScheduler(redis, "job-monitor");

    // Provider outage circuit breaker: probes open Gemini/OpenAI circuits every
    // minute and resumes their queues only after a cheap provider health check.
    const { startProviderCircuitScheduler } = await import("@/lib/provider-circuit-breaker");
    startProviderCircuitScheduler();
    await markWorkerScheduler(redis, "provider-circuit");

    // Platform spend circuit breaker — pauses expensive queues at 80% of the
    // daily budget, all generation queues at 100%. State in Redis.
    const { startSpendBreakerScheduler } = await import("@/lib/spend-breaker");
    startSpendBreakerScheduler();
    const readiness = await markWorkerScheduler(redis, "spend-breaker");
    if (!readiness.ready && !isDevelopmentCanaryOnlyUnready(readiness)) {
      throw new Error("Required worker registrations or schedulers did not reach readiness");
    }

    // Liveness begins only after the durable registration contract is ready.
    if (readiness.ready) {
      await startWorkerHeartbeat(redis);
    } else {
      processDiagnosticLog(
        "warn",
        "⚠️ [worker] Development workers remain active, but readiness is false because the real-provider canary accounting owner is not configured.",
      );
    }
    
    processDiagnosticLog("log", "🔄 Worker process running - event loop active");
    processDiagnosticLog("log", "Press Ctrl+C to stop workers");

    // Keep process alive
    process.stdin.resume();

  } catch (error) {
    await stopWorkerHeartbeat(redis).catch(() => {});
    await failWorkerReadiness(redis, error).catch(() => {});
    processDiagnosticLog("error", "❌ Worker initialization failed:", error);
    const err = error instanceof Error ? error : new Error(String(error));
    try {
      const { logError } = await import("../lib/error-logger");
      await runWithSystemContext("worker startup failure audit logging", () => logError({
        errorType: "SYSTEM",
        errorMessage: `[worker:startup] ${err.message}`,
        stackTrace: err.stack,
        severity: "critical",
        component: "worker-process",
      }));
    } finally {
      process.exit(1);
    }
  }
}

let shutdownPromise: Promise<void> | null = null;

// Graceful shutdown. One owner coordinates all resources so a queue-level
// signal handler cannot exit the process before active workers have drained.
async function shutdown(signal: NodeJS.Signals) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
  processDiagnosticLog("log", `🛑 ${signal} received — draining workers...`);
  let exitCode = 0;
  try {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    await stopWorkerHeartbeat(getRedisConnection());
    await clearWorkerReadiness(getRedisConnection());
    await stopJobMonitor();
    const [
      { stopProviderCircuitScheduler },
      { stopSpendBreakerScheduler },
    ] = await Promise.all([
      import("../lib/provider-circuit-breaker"),
      import("../lib/spend-breaker"),
    ]);
    stopProviderCircuitScheduler();
    stopSpendBreakerScheduler();

    const result = await closePipelineWorkers(30_000);
    if (result.timedOut) {
      exitCode = 1;
      processDiagnosticLog("error",
        `⚠️ Forced shutdown after deadline (${result.forced} worker connection(s)); BullMQ will recover unfinished jobs`
      );
    } else {
      processDiagnosticLog("log", `✅ Drained ${result.drained} BullMQ worker(s)`);
    }
    await closeQueues();
    processDiagnosticLog("log", "✅ Workers stopped gracefully");
  } catch (error) {
    processDiagnosticLog("error", "❌ Error during shutdown:", error);
    exitCode = 1;
  }
  process.exit(exitCode);
  })();
  return shutdownPromise;
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

// Start the workers
startWorkers();
