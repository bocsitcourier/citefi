import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { registerWorkers } from "../lib/worker";
import { closeQueues } from "../lib/queue";
import { startJobMonitor, stopJobMonitor } from "./job-monitor";
import { ensurePublishingSecretsReady } from "../lib/publishing";
import { neonHttpDb } from "../lib/db";

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
      logError({
        errorType: "SYSTEM",
        errorMessage: `[worker:uncaughtException] ${msg}`,
        stackTrace: err.stack,
        severity: "critical",
        component: "worker-process",
        context: { name: err.name },
      }).catch(() => {});
    }).catch(() => {});
  }
});

process.on("unhandledRejection", (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  const msg = err.message;
  console.error(`⚠️ [worker] Unhandled promise rejection (non-fatal): ${msg}`);
  import("../lib/error-logger").then(({ logError }) => {
    logError({
      errorType: "SYSTEM",
      errorMessage: `[worker:unhandledRejection] ${msg}`,
      stackTrace: err.stack,
      severity: "error",
      component: "worker-process",
    }).catch(() => {});
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
      await neonHttpDb.execute(sql`SELECT 1`);
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
    
    // Validate publishing secrets before starting workers
    await ensurePublishingSecretsReady();
    
    // Register all BullMQ workers
    await registerWorkers();
    
    // Start job monitoring for stuck job detection
    await startJobMonitor();
    
    console.log("🔄 Worker process running - event loop active");
    console.log("Press Ctrl+C to stop workers");

    // Keep process alive
    process.stdin.resume();

  } catch (error) {
    console.error("❌ Worker initialization failed:", error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  console.log("\n🛑 Shutting down workers...");
  try {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    await stopJobMonitor();
    await closeQueues();
    console.log("✅ Workers stopped gracefully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during shutdown:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start the workers
startWorkers();
