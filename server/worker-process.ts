import { config } from 'dotenv';
import { registerWorkers } from "../lib/worker";
import { closeQueues } from "../lib/queue";
import { startJobMonitor, stopJobMonitor } from "./job-monitor";
import { ensurePublishingSecretsReady } from "../lib/publishing";

config({ path: '.env.local' });

async function startWorkers() {
  try {
    console.log("🔄 Worker process starting...");
    
    // Validate publishing secrets before starting workers
    await ensurePublishingSecretsReady();
    
    // Register all pg-boss workers
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
