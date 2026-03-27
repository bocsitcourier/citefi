import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePooled } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import pLimit from "p-limit";
import * as schema from "@/shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

// ─── Semaphore ────────────────────────────────────────────────────────────────
// Hard cap: at most 15 DB operations can run simultaneously across all workers
// in this process. Must be < pool max (20) so the pool is never exhausted by
// one burst of concurrent workers, leaving headroom for pg-boss housekeeping.
// Excess callers queue locally instead of hammering Neon.
const DB_CONCURRENCY = 15;
const dbGuard = pLimit(DB_CONCURRENCY);

export async function safeQuery<T>(fn: () => Promise<T>): Promise<T> {
  return dbGuard(fn);
}

// ─── Client selection ─────────────────────────────────────────────────────────
// The worker process is spawned with WORKER_PROCESS=true (set in server/index.ts).
// Workers use a bounded pg connection pool — stable under 85+ concurrent jobs.
// Next.js API routes keep the stateless Neon HTTP driver (serverless-friendly).
const isWorkerProcess = process.env.WORKER_PROCESS === "true";

function buildDb(): NeonHttpDatabase<typeof schema> {
  if (isWorkerProcess) {
    // Prefer the dedicated pooler endpoint; fall back to the main URL (pg works
    // with either — the pooler just adds PgBouncer-style connection reuse).
    const connectionString =
      process.env.DATABASE_POOLED_URL ?? process.env.DATABASE_URL!;

    const pool = new Pool({
      connectionString,
      max: 20,                           // hard cap: 20 physical connections
      idleTimeoutMillis: 300_000,        // 5 min — outlasts 60s scheduler cycles
      connectionTimeoutMillis: 10_000,   // fail fast rather than queue forever
      keepAlive: true,                   // prevent Neon from killing idle conns
      keepAliveInitialDelayMillis: 10_000,
    });

    // Catch dead connections so Node doesn't deadlock when Neon restarts.
    // The pg library automatically discards the severed client; the pool
    // creates a fresh one on the next query.
    pool.on("error", (err) => {
      console.error(
        `🔥 DB pool error (dead connection discarded): ${err.message} [code: ${(err as any).code ?? "?"}]`
      );
    });

    // Drain the pool cleanly when the worker process exits
    process.on("beforeExit", () => pool.end().catch(() => {}));

    console.log(
      `🔌 DB: using pooled pg client (max 20 conns, semaphore ${DB_CONCURRENCY} — leaves 5 for pg-boss housekeeping)`
    );

    return drizzlePooled(pool, { schema }) as unknown as NeonHttpDatabase<
      typeof schema
    >;
  }

  // Default: Neon HTTP driver for Next.js API routes
  return drizzle(neon(process.env.DATABASE_URL!), { schema });
}

export const db = buildDb();
