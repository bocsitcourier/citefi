import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  auditAlertMessage,
  type StorageAuditReport,
} from "@/lib/storage-audit";

const CHECK_INTERVAL_MS = 5 * 60 * 1_000;
const RETRY_INTERVAL_MS = 60 * 60 * 1_000;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const LOCK_TTL_MS = 15 * 60 * 1_000;
const HISTORY_LIMIT = 90;

const LOCK_KEY = "media-storage-audit:lock";
const LAST_RUN_KEY = "media-storage-audit:last-run";
const RETRY_AFTER_KEY = "media-storage-audit:retry-after";
const HISTORY_KEY = "media-storage-audit:history";

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const RENEW_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

const VERIFY_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return 1
end
return 0
`;

// Validate every involved key before making any change. Redis scripts are
// atomic, so no worker can observe history without its matching schedule state,
// and a wrong-typed key cannot produce a partial MULTI-style commit.
const PERSIST_REPORT_SCRIPT = `
local function typename(key)
  local result = redis.call("type", key)
  if type(result) == "table" then return result["ok"] end
  return result
end
local historyType = typename(KEYS[1])
local lastRunType = typename(KEYS[2])
local retryType = typename(KEYS[3])
if historyType ~= "none" and historyType ~= "list" then
  return redis.error_reply("audit history key has invalid type")
end
if lastRunType ~= "none" and lastRunType ~= "string" then
  return redis.error_reply("audit last-run key has invalid type")
end
if retryType ~= "none" and retryType ~= "string" then
  return redis.error_reply("audit retry key has invalid type")
end
local length = redis.call("lpush", KEYS[1], ARGV[1])
redis.call("ltrim", KEYS[1], 0, ARGV[3])
redis.call("set", KEYS[2], ARGV[2])
redis.call("del", KEYS[3])
return length
`;

export interface AuditRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}

export interface StorageAuditMonitorDependencies {
  redis: AuditRedis;
  runAudit: () => Promise<StorageAuditReport>;
  deliverAlert: (report: StorageAuditReport, message: string) => Promise<void>;
  now: () => Date;
  setInterval: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  clearInterval: (timer: ReturnType<typeof setInterval>) => void;
  randomToken: () => string;
}

export interface StorageAuditMonitor {
  start(): void;
  stop(): Promise<void>;
  checkNow(): Promise<void>;
}

function parseTime(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseReport(raw: string): StorageAuditReport | null {
  try {
    const value = JSON.parse(raw) as Partial<StorageAuditReport>;
    return value.schemaVersion === 1 && value.kind === "media-storage-audit"
      ? value as StorageAuditReport
      : null;
  } catch {
    return null;
  }
}

function previousSameScope(
  history: string[],
  report: StorageAuditReport,
): StorageAuditReport | null {
  if (report.scopeId === null) return null;
  for (const raw of history) {
    const candidate = parseReport(raw);
    if (candidate?.scopeId === report.scopeId) return candidate;
  }
  return null;
}

function appendTrend(
  message: string,
  current: StorageAuditReport,
  previous: StorageAuditReport | null,
): string {
  if (!previous) return message;
  const fields = [
    ["primary", current.counts.orphanedPrimaryObjects, previous.counts.orphanedPrimaryObjects],
    ["legacy", current.counts.orphanedLegacyObjects, previous.counts.orphanedLegacyObjects],
  ] as const;
  const trends = fields.flatMap(([name, currentCount, previousCount]) => {
    if (currentCount === null || previousCount === null) return [];
    const delta = currentCount - previousCount;
    return [`${name} orphan delta ${delta >= 0 ? "+" : ""}${delta}`];
  });
  return trends.length === 0 ? message : `${message}\nTrend: ${trends.join(", ")}.`;
}

function logReport(report: StorageAuditReport): void {
  // Deliberately omit object keys, samples, issue text, and storage identities.
  console.log(JSON.stringify({
    event: "media_storage_audit",
    status: report.status,
    counts: report.counts,
  }));
}

async function isDue(
  dependencies: StorageAuditMonitorDependencies,
  nowMs: number,
): Promise<boolean> {
  const [lastRunRaw, retryAfterRaw] = await Promise.all([
    dependencies.redis.get(LAST_RUN_KEY),
    dependencies.redis.get(RETRY_AFTER_KEY),
  ]);
  const lastRun = parseTime(lastRunRaw);
  const retryAfter = parseTime(retryAfterRaw);
  // A retry marker represents an uncommitted prior attempt and takes
  // precedence over a stale/partially-written last-run marker.
  if (retryAfter !== null) return nowMs >= retryAfter;
  return lastRun === null || nowMs - lastRun >= DAILY_INTERVAL_MS;
}

export function createStorageAuditMonitor(
  dependencies: StorageAuditMonitorDependencies,
): StorageAuditMonitor {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  async function runCheck(): Promise<void> {
    const nowMs = dependencies.now().getTime();
    if (!await isDue(dependencies, nowMs)) return;

    const token = dependencies.randomToken();
    const acquired = await dependencies.redis.set(
      LOCK_KEY,
      token,
      "PX",
      LOCK_TTL_MS,
      "NX",
    );
    if (acquired !== "OK") return;

    let renewalTimer: ReturnType<typeof setInterval> | null = null;
    let renewal: Promise<void> = Promise.resolve();
    let leaseLost = false;
    const renewLease = () => {
      renewal = renewal.then(async () => {
        if (leaseLost) return;
        const renewed = await dependencies.redis.eval(
          RENEW_LOCK_SCRIPT,
          1,
          LOCK_KEY,
          token,
          String(LOCK_TTL_MS),
        );
        if (renewed !== 1) leaseLost = true;
      }).catch(() => {
        leaseLost = true;
        console.error("[storage-audit] distributed lock renewal failed");
      });
    };
    const assertLease = async () => {
      await renewal;
      if (leaseLost || await dependencies.redis.eval(
        VERIFY_LOCK_SCRIPT,
        1,
        LOCK_KEY,
        token,
      ) !== 1) {
        leaseLost = true;
        throw new Error("Storage audit lease lost");
      }
    };

    try {
      // A contender may have read stale schedule state while another worker
      // held the lock. The lock serializes this second authoritative check.
      if (!await isDue(dependencies, dependencies.now().getTime())) return;
      renewalTimer = dependencies.setInterval(renewLease, Math.floor(LOCK_TTL_MS / 3));
      renewalTimer.unref?.();
      const report = await dependencies.runAudit();
      const history = await dependencies.redis.lrange(HISTORY_KEY, 0, HISTORY_LIMIT - 1);
      const baseMessage = auditAlertMessage(report);
      if (baseMessage !== null) {
        await assertLease();
        const previous = previousSameScope(history, report);
        await dependencies.deliverAlert(report, appendTrend(baseMessage, report, previous));
      }

      await assertLease();
      const persisted = await dependencies.redis.eval(
        PERSIST_REPORT_SCRIPT,
        3,
        HISTORY_KEY,
        LAST_RUN_KEY,
        RETRY_AFTER_KEY,
        JSON.stringify(report),
        report.finishedAt,
        String(HISTORY_LIMIT - 1),
      );
      if (typeof persisted !== "number") {
        throw new Error("Storage audit persistence script failed");
      }
      logReport(report);
    } catch {
      // Do not leak provider errors, bucket names, keys, or database details.
      console.error("[storage-audit] audit or alert delivery failed; retry delayed");
      await dependencies.redis.set(
        RETRY_AFTER_KEY,
        new Date(nowMs + RETRY_INTERVAL_MS).toISOString(),
      ).catch(() => {
        console.error("[storage-audit] failed to persist retry schedule");
      });
    } finally {
      if (renewalTimer) dependencies.clearInterval(renewalTimer);
      await renewal;
      await dependencies.redis.eval(RELEASE_LOCK_SCRIPT, 1, LOCK_KEY, token).catch(() => {
        console.error("[storage-audit] failed to release distributed lock");
      });
    }
  }

  function checkNow(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (!inFlight) {
      inFlight = runCheck()
        .catch(() => {
          console.error("[storage-audit] schedule check failed");
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  }

  return {
    start() {
      if (timer) return;
      stopped = false;
      void checkNow();
      timer = dependencies.setInterval(() => {
        void checkNow();
      }, CHECK_INTERVAL_MS);
      timer.unref?.();
    },
    async stop() {
      stopped = true;
      if (timer) {
        dependencies.clearInterval(timer);
        timer = null;
      }
      await inFlight;
    },
    checkNow,
  };
}

async function deliverAdminAlert(
  report: StorageAuditReport,
  message: string,
): Promise<void> {
  const [
    { and, eq, isNull },
    { systemDb },
    { notifications, users },
  ] = await Promise.all([
    import("drizzle-orm"),
    import("@/lib/db"),
    import("@/shared/schema"),
  ]);
  const admins = await systemDb
    .select({ id: users.id })
    .from(users)
    .where(and(
      eq(users.role, "admin"),
      eq(users.accountStatus, "active"),
      isNull(users.deletedAt),
    ));
  if (admins.length === 0) {
    throw new Error("No active administrators available for storage audit alert");
  }

  await systemDb.insert(notifications).values(admins.map(({ id }) => ({
    userId: id,
    teamId: null,
    type: report.status === "INCOMPLETE" ? "error" : "warning",
    category: "system",
    title: "Media storage audit alert",
    message,
    read: 0,
    dismissed: 0,
  })));
}

let defaultMonitor: StorageAuditMonitor | null = null;
let ownerPool: Pool | null = null;

export async function startStorageAuditMonitor(): Promise<void> {
  if (defaultMonitor) return;
  const [
    { Pool: PgPool },
    { getRedisConnection },
    { runStorageAudit },
    { createLegacyInventory, createPrimaryInventory, loadStorageOwners },
  ] = await Promise.all([
    import("pg"),
    import("@/lib/queue"),
    import("@/lib/storage-audit"),
    import("@/lib/storage-inventory"),
  ]);
  ownerPool = new PgPool({
    connectionString: process.env.DATABASE_POOLED_URL ?? process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    query_timeout: 60_000,
    statement_timeout: 60_000,
    options: "-c default_transaction_read_only=on",
  });
  ownerPool.on("error", () => {
    console.error("[storage-audit] owner database pool idle connection failed");
  });
  const pool = ownerPool;
  defaultMonitor = createStorageAuditMonitor({
    // Ioredis exposes `set` as overloads; the monitor intentionally consumes
    // only the small Redis command surface declared above.
    redis: getRedisConnection() as unknown as AuditRedis,
    runAudit: () => runStorageAudit({
      owners: () => loadStorageOwners(pool),
      primary: createPrimaryInventory,
      legacy: createLegacyInventory,
    }),
    deliverAlert: deliverAdminAlert,
    now: () => new Date(),
    setInterval,
    clearInterval,
    randomToken: randomUUID,
  });
  defaultMonitor.start();
}

export async function stopStorageAuditMonitor(): Promise<void> {
  const monitor = defaultMonitor;
  defaultMonitor = null;
  await monitor?.stop();
  const pool = ownerPool;
  ownerPool = null;
  await pool?.end();
}