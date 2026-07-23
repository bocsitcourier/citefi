import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePooled } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import pLimit from "p-limit";
import * as schema from "@/shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

const DATABASE_URL = process.env.DATABASE_URL;

// Detect if we are talking to Neon cloud (HTTP driver required) or a standard
// PostgreSQL instance (local or external non-Neon) that needs the pg TCP driver.
// Replit's internal Neon proxy uses the hostname "helium"; external Neon cloud
// uses "*.neon.tech". Everything else (localhost, DO droplet, etc.) is standard pg.
const isNeonCloud =
  DATABASE_URL.includes("neon.tech") || DATABASE_URL.includes("@helium");

// ─── Neon rows:null shim ─────────────────────────────────────────────────────
// @neondatabase/serverless v0.10.x returns `"rows": null` (not `[]`) when a
// query matches zero rows. Only needed when actually talking to Neon cloud.
if (isNeonCloud) {
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

  neonConfig.fetchFunction = _neonFetch;
}

// ─── Semaphore ────────────────────────────────────────────────────────────────
// Hard cap: at most 15 DB operations can run simultaneously across all workers
// in this process. Must be < pool max (20) so the pool is never exhausted by
// one burst of concurrent workers, leaving headroom for pg-boss housekeeping.
const DB_CONCURRENCY = 15;
const dbGuard = pLimit(DB_CONCURRENCY);

export async function safeQuery<T>(fn: () => Promise<T>): Promise<T> {
  return dbGuard(fn);
}

// ─── Shared pool factory ──────────────────────────────────────────────────────
function makePool(connectionString: string, max: number, idleMs: number): Pool {
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: idleMs,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  pool.on("error", (err) => {
    console.error(
      `🔥 DB pool error (dead connection discarded): ${err.message} [code: ${(err as any).code ?? "?"}]`
    );
  });
  process.on("beforeExit", () => pool.end().catch(() => {}));
  return pool;
}

// ─── Client selection ─────────────────────────────────────────────────────────
// Worker processes always use a bounded pg connection pool (stable under high concurrency).
// Main (Next.js) process:
//   • Neon cloud  → Neon HTTP driver (serverless-safe, no persistent connection)
//   • Local/other → pg Pool (same driver as worker, works with any postgres)
const isWorkerProcess = process.env.WORKER_PROCESS === "true";

function buildDb(): NeonHttpDatabase<typeof schema> {
  const connectionString =
    process.env.DATABASE_POOLED_URL ?? DATABASE_URL;

  if (isWorkerProcess || !isNeonCloud) {
    const max = isWorkerProcess ? 20 : 10;
    const idleMs = isWorkerProcess ? 900_000 : 30_000;
    const pool = makePool(connectionString, max, idleMs);

    console.log(
      isNeonCloud
        ? `🔌 DB: pooled pg → Neon cloud (max ${max} conns, semaphore ${DB_CONCURRENCY})`
        : `🔌 DB: pooled pg → local postgres (max ${max} conns, semaphore ${DB_CONCURRENCY})`
    );

    return drizzlePooled(pool, { schema }) as unknown as NeonHttpDatabase<typeof schema>;
  }

  // Neon HTTP for main Next.js process when talking to Neon cloud
  console.log(`🔌 DB: Neon HTTP driver (serverless) → Neon cloud`);
  return drizzle(neon(DATABASE_URL), { schema });
}

export const db = buildDb();

// ─── Stateless / HTTP client ──────────────────────────────────────────────────
// For Neon cloud: uses the HTTP driver (immune to idle connection expiry).
// For local postgres: reuses a small pool — same behaviour, no HTTP overhead.
export const neonHttpDb: NeonHttpDatabase<typeof schema> = isNeonCloud
  ? drizzle(neon(DATABASE_URL), { schema })
  : (drizzlePooled(
      makePool(process.env.DATABASE_POOLED_URL ?? DATABASE_URL, 5, 30_000),
      { schema }
    ) as unknown as NeonHttpDatabase<typeof schema>);

// Alias used by video-pipeline and other stateless modules for clarity.
export const statelessDb = neonHttpDb;

// ─── Transaction-capable pooled client (for API routes) ─────────────────────
// The Neon HTTP driver does NOT support interactive transactions.
// Use this for multi-step atomic writes. Works with both Neon and local pg.
let _txPool: Pool | null = null;

export function getTxDb() {
  if (!_txPool) {
    _txPool = makePool(
      process.env.DATABASE_POOLED_URL ?? DATABASE_URL,
      5,
      30_000
    );
  }
  return drizzlePooled(_txPool, { schema });
}
