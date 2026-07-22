import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePooled } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import pLimit from "p-limit";
import * as schema from "@/shared/schema";

// ─── Neon rows:null shim ─────────────────────────────────────────────────────
// @neondatabase/serverless v0.10.x returns `"rows": null` (not `[]`) when a
// query matches zero rows. The driver then crashes inside processQueryResult
// with `TypeError: Cannot read properties of null (reading 'map')`.
// This shim intercepts every HTTP response from the Neon endpoint and
// normalises null → [] before the driver ever sees the body.
// Applied globally via neonConfig so it covers every neon() instance in the
// process, including statelessDb / neonHttpDb aliases created below.
const _globalFetch = globalThis.fetch.bind(globalThis);
const _neonFetch: typeof fetch = async (input, init) => {
  const res = await _globalFetch(input, init);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return res;

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(text, { status: res.status, headers: { "content-type": ct } });
  }

  function fixRows(obj: Record<string, unknown>) {
    if (obj !== null && typeof obj === "object") {
      if ("rows" in obj && obj.rows === null) obj.rows = [];
      if ("fields" in obj && obj.fields === null) obj.fields = [];
    }
    return obj;
  }

  const normalized = Array.isArray(body)
    ? body.map((item) => fixRows({ ...(item as Record<string, unknown>) }))
    : fixRows({ ...(body as Record<string, unknown>) });

  const headers = new Headers(res.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(normalized), { status: res.status, headers });
};

// Apply globally so all neon() instances in this process use the shim
neonConfig.fetchFunction = _neonFetch;

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
      idleTimeoutMillis: 900_000,        // 15 min — outlasts Gemini's 10-min hard timeout
      connectionTimeoutMillis: 10_000,   // fail fast rather than queue forever
      keepAlive: true,                   // TCP keepalive: prevent OS-level socket closure
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

// ─── Stateless HTTP client ─────────────────────────────────────────────────
// Use this for periodic, stateless queries (scheduled workers, job recovery).
// The Neon HTTP driver creates a fresh HTTPS request per query — it is immune
// to Neon compute suspension killing idle pooled sockets.  Do NOT use this
// for long-running transactions or video-generation workers (use `db`).
export const neonHttpDb = drizzle(neon(process.env.DATABASE_URL!), { schema });

// Alias used by video-pipeline and other stateless modules for clarity.
// Semantically equivalent to neonHttpDb — both use the Neon HTTP driver.
export const statelessDb = neonHttpDb;

// ─── Transaction-capable pooled client (for API routes) ─────────────────────
// The Neon HTTP driver (`db` in the main process) does NOT support interactive
// transactions. For multi-step writes that must be atomic, use this lazily-
// created pooled pg client. Safe in the long-running Next.js process on Replit.
let _txPool: Pool | null = null;

export function getTxDb() {
  if (!_txPool) {
    _txPool = new Pool({
      connectionString: process.env.DATABASE_POOLED_URL ?? process.env.DATABASE_URL!,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
    });
    _txPool.on("error", (err) => {
      console.error(
        `🔥 Tx pool error (dead connection discarded): ${err.message} [code: ${(err as any).code ?? "?"}]`
      );
    });
    process.on("beforeExit", () => _txPool?.end().catch(() => {}));
  }
  return drizzlePooled(_txPool, { schema });
}
