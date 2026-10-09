import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createStorageAuditMonitor,
  type AuditRedis,
} from "../server/storage-audit-monitor";
import type { StorageAuditReport } from "../lib/storage-audit";

const HOUR = 60 * 60 * 1_000;

function report(options: {
  finishedAt: string;
  status?: StorageAuditReport["status"];
  scopeId?: string | null;
  primaryOrphans?: number | null;
  legacyOrphans?: number | null;
}): StorageAuditReport {
  const status = options.status ?? "PASS";
  return {
    schemaVersion: 1,
    kind: "media-storage-audit",
    startedAt: options.finishedAt,
    finishedAt: options.finishedAt,
    scopeId: options.scopeId ?? "scope-a",
    status,
    issues: status === "PASS" ? [] : ["TEST_DRIFT"],
    counts: {
      databaseOwners: 1,
      referencedObjects: 1,
      missingOwnedObjects: status === "PASS" ? 0 : 1,
      invalidOwners: 0,
      primaryObjects: 1,
      legacyObjects: 1,
      legacyOnlyObjects: 0,
      orphanedPrimaryObjects: options.primaryOrphans ?? 0,
      orphanedLegacyObjects: options.legacyOrphans ?? 0,
    },
    samples: {
      missingOwnedObjects: [],
      legacyOnlyObjects: [],
      orphanedPrimaryObjects: [],
      orphanedLegacyObjects: [],
    },
  };
}

class MemoryRedis implements AuditRedis {
  strings = new Map<string, string>();
  lists = new Map<string, string[]>();
  persistReply: unknown | undefined;
  beforeLock: (() => void) | null = null;
  loseLeaseOnHistoryRead = false;

  async get(key: string) {
    return this.strings.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: Array<string | number>) {
    if (key.endsWith(":lock")) {
      this.beforeLock?.();
      this.beforeLock = null;
      if (args.includes("NX") && this.strings.has(key)) return null;
    }
    this.strings.set(key, value);
    return "OK";
  }

  async lrange(key: string, start: number, stop: number) {
    if (this.loseLeaseOnHistoryRead) {
      this.strings.delete("media-storage-audit:lock");
      this.loseLeaseOnHistoryRead = false;
    }
    return (this.lists.get(key) ?? []).slice(start, stop + 1);
  }

  async eval(script: string, _numberOfKeys: number, ...args: string[]) {
    if (script.includes('redis.call("pexpire"')) {
      return this.strings.get(args[0]!) === args[1] ? 1 : 0;
    }
    if (script.includes('redis.call("lpush"')) {
      if (this.persistReply !== undefined) return this.persistReply;
      const [historyKey, lastRunKey, retryKey, serialized, finishedAt, stop] = args;
      const list = this.lists.get(historyKey!) ?? [];
      list.unshift(serialized!);
      this.lists.set(historyKey!, list.slice(0, Number(stop) + 1));
      this.strings.set(lastRunKey!, finishedAt!);
      this.strings.delete(retryKey!);
      return list.length;
    }
    if (script.includes('redis.call("del"')) {
      if (this.strings.get(args[0]!) === args[1]) {
        this.strings.delete(args[0]!);
        return 1;
      }
      return 0;
    }
    return this.strings.get(args[0]!) === args[1] ? 1 : 0;
  }
}

function harness(options: {
  redis?: MemoryRedis;
  initialTime?: string;
  runAudit?: () => Promise<StorageAuditReport>;
  deliverAlert?: (value: StorageAuditReport, message: string) => Promise<void>;
} = {}) {
  const redis = options.redis ?? new MemoryRedis();
  let now = new Date(options.initialTime ?? "2026-01-01T00:00:00.000Z");
  let runs = 0;
  const monitor = createStorageAuditMonitor({
    redis,
    runAudit: options.runAudit ?? (async () => {
      runs++;
      return report({ finishedAt: now.toISOString() });
    }),
    deliverAlert: options.deliverAlert ?? (async () => {}),
    now: () => now,
    setInterval,
    clearInterval,
    randomToken: () => `token-${runs}`,
  });
  return {
    redis,
    monitor,
    runs: () => runs,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
  };
}

describe("storage audit monitor scheduler", () => {
  test("runs once daily and gates subsequent checks", async () => {
    const value = harness();
    await value.monitor.checkNow();
    await value.monitor.checkNow();
    assert.equal(value.runs(), 1);
    value.advance(24 * HOUR);
    await value.monitor.checkNow();
    assert.equal(value.runs(), 2);
  });

  test("re-checks schedule state after acquiring the shared lock", async () => {
    const redis = new MemoryRedis();
    const value = harness({ redis });
    redis.beforeLock = () => {
      redis.strings.set(
        "media-storage-audit:last-run",
        value.now().toISOString(),
      );
    };
    await value.monitor.checkNow();
    assert.equal(value.runs(), 0);
    assert.equal(redis.strings.has("media-storage-audit:lock"), false);
  });

  test("does not audit while another process owns the shared lock", async () => {
    const redis = new MemoryRedis();
    const value = harness({ redis });
    redis.strings.set("media-storage-audit:lock", "other-process-token");
    await value.monitor.checkNow();
    assert.equal(value.runs(), 0);
    assert.equal(redis.strings.get("media-storage-audit:lock"), "other-process-token");
    redis.strings.delete("media-storage-audit:lock");
    await value.monitor.checkNow();
    assert.equal(value.runs(), 1);
  });

  test("concurrent workers cannot both audit", async () => {
    const redis = new MemoryRedis();
    let releaseAudit!: () => void;
    const auditBlocked = new Promise<void>((resolve) => {
      releaseAudit = resolve;
    });
    let firstRuns = 0;
    let secondRuns = 0;
    const first = harness({
      redis,
      runAudit: async () => {
        firstRuns++;
        await auditBlocked;
        return report({ finishedAt: "2026-01-01T00:00:00.000Z" });
      },
    });
    const second = harness({
      redis,
      runAudit: async () => {
        secondRuns++;
        return report({ finishedAt: "2026-01-01T00:00:00.000Z" });
      },
    });
    const firstCheck = first.monitor.checkNow();
    await new Promise((resolve) => setImmediate(resolve));
    await second.monitor.checkNow();
    assert.equal(firstRuns, 1);
    assert.equal(secondRuns, 0);
    releaseAudit();
    await firstCheck;
  });

  test("retains only the newest 90 reports", async () => {
    const value = harness();
    for (let index = 0; index < 95; index++) {
      await value.monitor.checkNow();
      value.advance(25 * HOUR);
    }
    assert.equal(value.redis.lists.get("media-storage-audit:history")?.length, 90);
  });

  test("notification failure records one-hour retry without advancing history", async () => {
    let attempts = 0;
    const value = harness({
      runAudit: async () => {
        attempts++;
        return report({
          finishedAt: value.now().toISOString(),
          status: "DRIFT",
        });
      },
      deliverAlert: async () => {
        throw new Error("private delivery unavailable");
      },
    });
    await value.monitor.checkNow();
    assert.equal(attempts, 1);
    assert.equal(value.redis.lists.get("media-storage-audit:history"), undefined);
    await value.monitor.checkNow();
    assert.equal(attempts, 1);
    value.advance(HOUR);
    await value.monitor.checkNow();
    assert.equal(attempts, 2);
  });

  test("orphan trends compare only reports in the same non-null scope", async () => {
    const messages: string[] = [];
    let run = 0;
    const value = harness({
      runAudit: async () => {
        run++;
        return report({
          finishedAt: value.now().toISOString(),
          status: "DRIFT",
          scopeId: "scope-b",
          primaryOrphans: run === 1 ? 4 : 7,
          legacyOrphans: run === 1 ? 2 : 1,
        });
      },
      deliverAlert: async (_audit, message) => {
        messages.push(message);
      },
    });
    value.redis.lists.set("media-storage-audit:history", [
      JSON.stringify(report({
        finishedAt: "2025-12-30T00:00:00.000Z",
        status: "DRIFT",
        scopeId: "scope-a",
        primaryOrphans: 99,
      })),
    ]);
    await value.monitor.checkNow();
    assert.equal(messages[0]?.includes("Trend:"), false);
    value.advance(25 * HOUR);
    await value.monitor.checkNow();
    assert.match(messages[1] ?? "", /primary orphan delta \+3/);
    assert.match(messages[1] ?? "", /legacy orphan delta -1/);
  });

  test("atomic Redis persistence errors do not advance history or last-run", async () => {
    const redis = new MemoryRedis();
    redis.persistReply = new Error("WRONGTYPE");
    const value = harness({ redis });
    await value.monitor.checkNow();
    assert.equal(redis.strings.has("media-storage-audit:last-run"), false);
    assert.equal(redis.lists.has("media-storage-audit:history"), false);
    assert.ok(redis.strings.has("media-storage-audit:retry-after"));
  });

  test("retry marker overrides a stale last-run from a legacy partial EXEC", async () => {
    const redis = new MemoryRedis();
    redis.strings.set("media-storage-audit:last-run", "2026-01-01T00:00:00.000Z");
    redis.strings.set("media-storage-audit:retry-after", "2026-01-01T01:00:00.000Z");
    const value = harness({
      redis,
      initialTime: "2026-01-01T01:00:00.000Z",
    });
    await value.monitor.checkNow();
    assert.equal(value.runs(), 1);
  });

  test("lease loss prevents alert delivery and persistence", async () => {
    const redis = new MemoryRedis();
    redis.loseLeaseOnHistoryRead = true;
    let delivered = 0;
    const value = harness({
      redis,
      runAudit: async () => report({
        finishedAt: "2026-01-01T00:00:00.000Z",
        status: "DRIFT",
      }),
      deliverAlert: async () => {
        delivered++;
      },
    });
    await value.monitor.checkNow();
    assert.equal(delivered, 0);
    assert.equal(redis.lists.has("media-storage-audit:history"), false);
    assert.equal(redis.strings.has("media-storage-audit:last-run"), false);
    assert.ok(redis.strings.has("media-storage-audit:retry-after"));
  });
});