import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { registerWorkers } from "../lib/worker";
import { validateAndResolveModels } from "../lib/model-resolver";
import { validateApprovalTokenSecret } from "../lib/approval-token";
import { closeQueues } from "../lib/queue";
import { closePipelineWorkers } from "../lib/pipeline-worker";
import { startJobMonitor, stopJobMonitor } from "./job-monitor";
import { ensurePublishingSecretsReady } from "../lib/publishing";
import { systemDb } from "../lib/db";
import { runWithSystemContext } from "../lib/tenant-context";

config({ path: '.env.local', override: true });

// ── Crash prevention ──────────────────────────────────────────────────────────
// pg-boss internals can throw "Connection terminated unexpectedly" when Neon
// suspends compute during a long-running article generation (10-min Gemini
// timeout > 5-min Neon idle window).  Without this handler the worker process
// exits, leaving every in-progress article stuck forever.
process.on("uncaughtException", (err: Error) => {
  const msg = err.message ?? "";
  const isConnErr =
    msg.includes("Connection terminated") ||
    msg.includes("connection timeout") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE");
  if (isConnErr) {
    console.error(`⚠️ [worker] DB connection error (non-fatal, continuing): ${msg}`);
  } else {
    console.error(`❌ [worker] Uncaught exception — logging but NOT exiting:`, err);
    // Fire-and-forget — do not await; uncaughtException handlers must not block
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
      ).catch(() => {});
    }).catch(() => {});
  }
});

process.on("unhandledRejection", (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  const msg = err.message;
  console.error(`⚠️ [worker] Unhandled promise rejection (non-fatal): ${msg}`);
  import("../lib/error-logger").then(({ logError }) => {
    runWithSystemContext("worker unhandled rejection audit logging", () =>
      logError({
        errorType: "SYSTEM",
        errorMessage: `[worker:unhandledRejection] ${msg}`,
        stackTrace: err.stack,
        severity: "error",
        component: "worker-process",
      })
    ).catch(() => {});
  }).catch(() => {});
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
      console.warn(`⚠️ [worker] Neon keep-alive ping failed (non-fatal):`, (e as Error).message);
    }
  }, NEON_PING_INTERVAL_MS);
  // Don't let the timer block process shutdown
  keepAliveTimer.unref();
}

async function startWorkers() {
  try {
    console.log("🔄 Worker process starting...");

    // Start keep-alive before any long-running work
    startNeonKeepAlive();

    // ── Storage configuration check ───────────────────────────────────────────
    // Non-fatal: other workers (articles, social posts, etc.) don't need storage.
    // Video generation jobs will fail fast with STORAGE_NOT_CONFIGURED instead of
    // silently burning Veo quota and leaving posts stuck at GENERATING.
    const { isStorageConfigured } = await import("../lib/storage");
    if (!isStorageConfigured) {
      console.warn(
        "⚠️ [startup] DO Spaces storage not configured — video generation jobs will " +
        "be rejected immediately with STORAGE_NOT_CONFIGURED. " +
        "Set DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_ENDPOINT, and DO_SPACES_BUCKET."
      );
    } else {
      console.log("✅ [startup] Storage (DO Spaces) is configured — video generation enabled.");
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
    
    // Register all BullMQ workers
    await registerWorkers();
    
    // Start job monitoring for stuck job detection
    await startJobMonitor();

    // Provider outage circuit breaker: probes open Gemini/OpenAI circuits every
    // minute and resumes their queues only after a cheap provider health check.
    const { startProviderCircuitScheduler } = await import("@/lib/provider-circuit-breaker");
    startProviderCircuitScheduler();

    // Platform spend circuit breaker — pauses expensive queues at 80% of the
    // daily budget, all generation queues at 100%. State in Redis.
    const { startSpendBreakerScheduler } = await import("@/lib/spend-breaker");
    startSpendBreakerScheduler();
    
    console.log("🔄 Worker process running - event loop active");
    console.log("Press Ctrl+C to stop workers");

    // Keep process alive
    process.stdin.resume();

  } catch (error) {
    console.error("❌ Worker initialization failed:", error);
    process.exit(1);
  }
}

let shutdownPromise: Promise<void> | null = null;

// Graceful shutdown. One owner coordinates all resources so a queue-level
// signal handler cannot exit the process before active workers have drained.
async function shutdown(signal: NodeJS.Signals) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
  console.log(`\n🛑 ${signal} received — draining workers...`);
  let exitCode = 0;
  try {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
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
      console.error(
        `⚠️ Forced shutdown after deadline (${result.forced} worker connection(s)); BullMQ will recover unfinished jobs`
      );
    } else {
      console.log(`✅ Drained ${result.drained} BullMQ worker(s)`);
    }
    await closeQueues();
    console.log("✅ Workers stopped gracefully");
  } catch (error) {
    console.error("❌ Error during shutdown:", error);
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
