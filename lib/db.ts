import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePooled } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import pLimit from "p-limit";
import * as schema from "@/shared/schema";
import {
  getDatabaseExecutionContext,
  type TenantExecutionContext,
} from "@/lib/tenant-context";

export class UnscopedDatabaseAccessError extends Error {
  constructor() {
    super(
      "Database access requires a validated tenant context or an explicit system context"
    );
    this.name = "UnscopedDatabaseAccessError";
  }
}

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
async function applyTenantSessionContext(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  context: TenantExecutionContext
): Promise<void> {
  await client.query("SET LOCAL ROLE citefi_tenant");
  await client.query(
    `SELECT
       set_config('citefi.actor_type', $1, true),
       set_config('citefi.user_id', $2, true),
       set_config('citefi.team_id', $3, true),
       set_config('citefi.member_role', $4, true)`,
    [
      context.actorType,
      context.userId == null ? "" : String(context.userId),
      String(context.teamId),
      context.role,
    ]
  );
}

function makePool(
  connectionString: string,
  max: number,
  idleMs: number,
  contextAware = false
): Pool {
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

  if (contextAware) {
    const rawQuery = pool.query.bind(pool);
    const rawConnect = pool.connect.bind(pool);

    (pool as any).query = (
      queryConfig: unknown,
      valuesOrCallback?: unknown,
      maybeCallback?: unknown
    ) => {
      const context = getDatabaseExecutionContext();
      if (!context || context.scope === "blocked") {
        const error = new UnscopedDatabaseAccessError();
        const callback =
          typeof valuesOrCallback === "function"
            ? valuesOrCallback
            : typeof maybeCallback === "function"
              ? maybeCallback
              : undefined;
        if (callback) {
          queueMicrotask(() => (callback as Function)(error));
          return;
        }
        return Promise.reject(error);
      }
      if (context.scope === "system") {
        return (rawQuery as any)(queryConfig, valuesOrCallback, maybeCallback);
      }

      const callback =
        typeof valuesOrCallback === "function"
          ? valuesOrCallback
          : typeof maybeCallback === "function"
            ? maybeCallback
            : undefined;
      const values = typeof valuesOrCallback === "function"
        ? undefined
        : valuesOrCallback;

      const promise = (async () => {
        const client = await rawConnect();
        try {
          await client.query("BEGIN");
          await applyTenantSessionContext(client, context);
          const result = values === undefined
            ? await (client.query as any)(queryConfig)
            : await (client.query as any)(queryConfig, values);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      })();

      if (callback) {
        promise.then(
          (result) => (callback as Function)(null, result),
          (error) => (callback as Function)(error)
        );
        return;
      }
      return promise;
    };
  }

  return pool;
}

// ─── Client selection ─────────────────────────────────────────────────────────
// Worker processes always use a bounded pg connection pool (stable under high concurrency).
// Main (Next.js) process:
//   • Neon cloud  → Neon HTTP driver (serverless-safe, no persistent connection)
//   • Local/other → pg Pool (same driver as worker, works with any postgres)
const isWorkerProcess = process.env.WORKER_PROCESS === "true";

// Held so closeDb() can end the pool deterministically (test teardown).
let mainPool: Pool | null = null;
let systemPool: Pool | null = null;
let _txPool: Pool | null = null;
let _systemTxDb: ReturnType<typeof drizzlePooled> | null = null;

function buildDb(): NeonHttpDatabase<typeof schema> {
  const connectionString =
    process.env.DATABASE_POOLED_URL ?? DATABASE_URL;

  {
    const max = isWorkerProcess ? 20 : 10;
    const idleMs = isWorkerProcess ? 900_000 : 30_000;
    const pool = makePool(connectionString, max, idleMs, true);
    mainPool = pool;

    console.log(
      isNeonCloud
        ? `🔌 DB: tenant-aware pooled pg → Neon cloud (max ${max} conns, semaphore ${DB_CONCURRENCY})`
        : `🔌 DB: pooled pg → local postgres (max ${max} conns, semaphore ${DB_CONCURRENCY})`
    );

    return drizzlePooled(pool, { schema }) as unknown as NeonHttpDatabase<typeof schema>;
  }
}

export const db = buildDb();

/**
 * Deterministically close every pooled connection owned by this module (a
 * no-op for pools that were never opened). Intended for test teardown and
 * graceful worker shutdown so node:test/processes exit cleanly.
 */
export async function closeDb(): Promise<void> {
  const pools = [mainPool, systemPool, _txPool].filter(
    (pool, index, all): pool is Pool => Boolean(pool) && all.indexOf(pool) === index
  );
  mainPool = null;
  systemPool = null;
  _txPool = null;
  _systemTxDb = null;
  await Promise.all(pools.map((pool) => pool.end().catch(() => {})));
}

// ─── Explicit privileged system client ────────────────────────────────────────
// This is intentionally a separately named pooled client. It preserves normal
// PostgreSQL RETURNING/transaction semantics while making BYPASSRLS access
// visible at every call site. Tenant-facing code must use `db`, never this.
systemPool = makePool(
  process.env.DATABASE_POOLED_URL ?? DATABASE_URL,
  5,
  30_000
);
export const systemDb = drizzlePooled(systemPool, { schema });

/**
 * Context-enforced stateless facade. System/bootstrap callers must import the
 * deliberately named systemDb instead; tenant callers are routed through the
 * pooled RLS gateway because Neon HTTP cannot preserve transaction-local role.
 */
export const neonHttpDb: NeonHttpDatabase<typeof schema> = new Proxy(
  systemDb as unknown as NeonHttpDatabase<typeof schema>,
  {
  get(target, property) {
    const context = getDatabaseExecutionContext();
    if (!context || context.scope === "blocked") {
      throw new UnscopedDatabaseAccessError();
    }
    const selected = context.scope === "tenant"
      ? (db as unknown as typeof systemDb)
      : target;
    const value = Reflect.get(selected, property, selected);
    return typeof value === "function" ? value.bind(selected) : value;
  },
  }
);

export const statelessDb = neonHttpDb;

// ─── Transaction-capable pooled client (for API routes) ─────────────────────
// The Neon HTTP driver does NOT support interactive transactions.
// Use this for multi-step atomic writes. Works with both Neon and local pg.
export function getTxDb() {
  if (!_txPool) {
    _txPool = makePool(
      process.env.DATABASE_POOLED_URL ?? DATABASE_URL,
      5,
      30_000
    );
    _systemTxDb = drizzlePooled(_txPool, { schema });
  }
  if (!_systemTxDb) {
    _systemTxDb = drizzlePooled(_txPool, { schema });
  }

  const context = getDatabaseExecutionContext();
  if (!context || context.scope === "blocked") {
    throw new UnscopedDatabaseAccessError();
  }
  if (context.scope === "system") {
    return _systemTxDb;
  }

  // Legacy callers use getTxDb() for both one-off statements and interactive
  // transactions. Under a validated tenant context neither path may touch the
  // BYPASSRLS login role directly:
  //   * one-off statements go through the context-aware main pool;
  //   * transaction() delegates to withTenantTransaction(), which checks out
  //     one connection and applies SET LOCAL ROLE + transaction-local GUCs.
  const tenantDb = db as unknown as typeof _systemTxDb;
  return new Proxy(_systemTxDb, {
    get(target, property) {
      if (property === "transaction") {
        return async (fn: (tx: typeof _systemTxDb) => Promise<unknown>) =>
          withTenantTransaction((tx) => fn(tx));
      }
      const value = Reflect.get(tenantDb, property, tenantDb);
      return typeof value === "function" ? value.bind(tenantDb) : value;
    },
  });
}

/**
 * Run an interactive transaction on one checked-out connection using the
 * current validated tenant context. SET LOCAL and ROLE are transaction-scoped,
 * so pooled connections cannot retain another request's identity.
 */
export async function withTenantTransaction<T>(
  fn: (tx: ReturnType<typeof getTxDb>) => Promise<T>,
  options?: {
    isolationLevel?: "read committed" | "repeatable read" | "serializable";
    maxRetries?: number;
  },
): Promise<T> {
  const context = getDatabaseExecutionContext();
  if (context?.scope !== "tenant") {
    throw new Error("Tenant transaction requested without a validated tenant context");
  }
  if (!_txPool) {
    _txPool = makePool(
      process.env.DATABASE_POOLED_URL ?? DATABASE_URL,
      5,
      30_000
    );
  }
  const maxRetries = Math.max(0, options?.maxRetries ?? 0);
  for (let attempt = 0; ; attempt++) {
    const client = await _txPool.connect();
    try {
      const isolation = options?.isolationLevel?.toUpperCase();
      await client.query(isolation ? `BEGIN ISOLATION LEVEL ${isolation}` : "BEGIN");
      await applyTenantSessionContext(client, context);
      const tx = drizzlePooled(client, { schema }) as unknown as ReturnType<typeof getTxDb>;
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error: any) {
      await client.query("ROLLBACK").catch(() => {});
      if (attempt >= maxRetries || !["40001", "40P01"].includes(error?.code)) throw error;
    } finally {
      client.release();
    }
  }
}
