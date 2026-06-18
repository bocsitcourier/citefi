/**
 * DB-backed fixed-window rate limiter.
 * Survives server restarts; works across processes.
 * Keys are HMAC-SHA256 hashed (peppered with JWT_SECRET) so IPs/emails are never stored in plaintext.
 *
 * Use this for all auth-critical endpoints (login, signup, 2FA, password flows).
 * Keep lib/rate-limit.ts for non-security UI throttles only.
 */
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export { getClientIp } from "@/lib/rate-limit";

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number; // seconds until the window resets
}

/**
 * HMAC-SHA256 of the rate-limit key using JWT_SECRET as a pepper.
 * - Prevents dictionary attacks against stored hashes (IPv4 space is tiny).
 * - IPs and emails are never stored in plaintext in the DB.
 * Falls back to a process-scoped random pepper if JWT_SECRET is unavailable
 * (table will reset on restart in that case, matching in-memory behaviour).
 */
const HMAC_PEPPER: string =
  process.env.JWT_SECRET ||
  crypto.randomBytes(32).toString("hex");

function hashKey(key: string): string {
  return crypto.createHmac("sha256", HMAC_PEPPER).update(key).digest("hex");
}

// ── Table bootstrap ───────────────────────────────────────────────────────────
let tableReady = false;
let tableInitPromise: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  if (!tableInitPromise) {
    tableInitPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS rate_limit_windows (
          key_hash VARCHAR(64) PRIMARY KEY,
          count    INTEGER     NOT NULL DEFAULT 1,
          reset_at TIMESTAMPTZ NOT NULL
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS rate_limit_windows_reset_at_idx
        ON rate_limit_windows (reset_at)
      `);
      tableReady = true;
    })().catch((e) => {
      // Reset so next call retries
      tableInitPromise = null;
      throw e;
    });
  }
  await tableInitPromise;
}

// ── Opportunistic cleanup ────────────────────────────────────────────────────
let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 60_000;

function scheduleCleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  db.execute(sql`DELETE FROM rate_limit_windows WHERE reset_at < NOW()`)
    .catch(() => {});
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * DB-backed fixed-window rate limit. Returns { allowed, retryAfter }.
 *
 * @param key      Unique bucket identifier — will be SHA-256 hashed before storage.
 * @param limit    Max requests allowed in the window.
 * @param windowMs Window duration in milliseconds.
 */
export async function rateLimitDb(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  await ensureTable();
  scheduleCleanup();

  const keyHash = hashKey(key);
  const newResetAt = new Date(Date.now() + windowMs);

  // Atomic upsert — PostgreSQL guarantees the CASE WHEN runs under a row lock.
  // If reset_at has expired, treat as a fresh window (count resets to 1).
  const result = await db.execute(sql`
    INSERT INTO rate_limit_windows (key_hash, count, reset_at)
    VALUES (${keyHash}, 1, ${newResetAt})
    ON CONFLICT (key_hash) DO UPDATE SET
      count = CASE
        WHEN rate_limit_windows.reset_at <= NOW() THEN 1
        ELSE rate_limit_windows.count + 1
      END,
      reset_at = CASE
        WHEN rate_limit_windows.reset_at <= NOW() THEN ${newResetAt}
        ELSE rate_limit_windows.reset_at
      END
    RETURNING count, reset_at
  `);

  const row = (result.rows?.[0] ?? result[0]) as
    | { count: number; reset_at: string | Date }
    | undefined;

  const count = typeof row?.count === "number" ? row.count : 1;
  const resetAt = row?.reset_at
    ? new Date(row.reset_at as string)
    : newResetAt;
  const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));

  return {
    allowed: count <= limit,
    retryAfter: count > limit ? retryAfter : 0,
  };
}
