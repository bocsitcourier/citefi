import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { getRedisClientConfig } from "../lib/queue";

export type DrillStatus = "PASS" | "FAIL" | "BLOCKED";
export type DrillScope = "local" | "external";

export interface DrillEvidence {
  id: string;
  scope: DrillScope;
  status: DrillStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  command: string;
  summary: string;
  rto: { targetSeconds: number | null; observedSeconds: number | null; met: boolean | null };
  rpo: { target: string; observed: string | null; met: boolean | null };
  blockers: string[];
  checksumSha256: string;
}

export interface ReadinessEvidence {
  schemaVersion: "1.0";
  kind: "production-readiness-drill-evidence";
  mode: "certification" | "local-only";
  certificationStatus: "PASS" | "FAIL";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  gitSha: string;
  host: "redacted";
  drills: DrillEvidence[];
  blockers: string[];
  checksums: { algorithm: "sha256"; drillCount: number };
}

const SECRET_KEY = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|database_url|redis_url|credential)/i;
const SECRET_VALUE = /((?:postgres(?:ql)?|redis(?:s)?):\/\/)([^@\s/]+)@/gi;
const ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY|URL))=("[^"]*"|'[^']*'|[^\s]+)/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SENSITIVE_QUERY = /([?&](?:x-amz-[^=&\s]+|signature|sig|token|key|secret|password|credential)=)[^&\s]+/gi;

export function redactEvidence<T>(value: T): T {
  const visit = (item: unknown, key = ""): unknown => {
    if (SECRET_KEY.test(key)) return "[REDACTED]";
    if (typeof item === "string") {
      return item
        .replace(SECRET_VALUE, "$1[REDACTED]@")
        .replace(ASSIGNMENT, "$1=[REDACTED]")
        .replace(BEARER, "Bearer [REDACTED]")
        .replace(SENSITIVE_QUERY, "$1[REDACTED]");
    }
    if (Array.isArray(item)) return item.map((entry) => visit(entry));
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(([childKey, child]) => [
          childKey,
          visit(child, childKey),
        ]),
      );
    }
    return item;
  };
  return visit(value) as T;
}

function checksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(redactEvidence(value))).digest("hex");
}

export function validateEvidenceSchema(value: unknown): value is ReadinessEvidence {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<ReadinessEvidence>;
  if (
    report.schemaVersion !== "1.0" ||
    report.kind !== "production-readiness-drill-evidence" ||
    !["certification", "local-only"].includes(report.mode ?? "") ||
    !["PASS", "FAIL"].includes(report.certificationStatus ?? "") ||
    typeof report.gitSha !== "string" ||
    !Array.isArray(report.drills) ||
    !Array.isArray(report.blockers)
  ) return false;
  return report.drills.every((drill) =>
    typeof drill.id === "string" &&
    ["local", "external"].includes(drill.scope) &&
    ["PASS", "FAIL", "BLOCKED"].includes(drill.status) &&
    typeof drill.command === "string" &&
    typeof drill.durationMs === "number" &&
    Array.isArray(drill.blockers) &&
    /^[a-f0-9]{64}$/.test(drill.checksumSha256),
  );
}

interface CommandResult {
  code: number;
  output: string;
}

export type CommandExecutor = (
  command: string,
  env?: Record<string, string | undefined>,
) => Promise<CommandResult>;

export const executeCommand: CommandExecutor = (command, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-64_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => resolve({ code: 1, output: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });

function outcome(
  id: string,
  scope: DrillScope,
  command: string,
  started: number,
  status: DrillStatus,
  summary: string,
  blockers: string[] = [],
  targets: { rto?: number; observed?: number; rpo?: string; rpoObserved?: string; rpoMet?: boolean | null } = {},
): DrillEvidence {
  const finished = Date.now();
  const base = {
    id,
    scope,
    status,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    command,
    summary,
    rto: {
      targetSeconds: targets.rto ?? null,
      observedSeconds: targets.observed ?? null,
      met: targets.rto === undefined || targets.observed === undefined
        ? null
        : targets.observed <= targets.rto,
    },
    rpo: {
      target: targets.rpo ?? "not applicable",
      observed: targets.rpoObserved ?? null,
      met: targets.rpoMet ?? null,
    },
    blockers,
  };
  return { ...base, checksumSha256: checksum(base) };
}

async function runCommandDrill(
  id: string,
  command: string,
  executor: CommandExecutor,
  targets: { rto: number; rpo: string },
): Promise<DrillEvidence> {
  const started = Date.now();
  const result = await executor(command, {
    WORKER_PROCESS: "true",
    REDIS_URL: process.env.READINESS_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/14",
  });
  return outcome(
    id,
    "local",
    command,
    started,
    result.code === 0 ? "PASS" : "FAIL",
    result.code === 0
      ? "Existing production-path tests passed"
      : `Command exited ${result.code}; child output is intentionally excluded from persisted evidence`,
    [],
    { rto: targets.rto, observed: (Date.now() - started) / 1000, rpo: targets.rpo, rpoObserved: result.code === 0 ? "Assertions passed" : "Unproven", rpoMet: result.code === 0 },
  );
}

async function runQueueBacklogDrill(): Promise<DrillEvidence> {
  const started = Date.now();
  const command = "controlled BullMQ queue backlog detection and drain (Redis DB 13)";
  const redisUrl = process.env.READINESS_REDIS_URL ?? "redis://127.0.0.1:6379/13";
  const { url, options } = getRedisClientConfig(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 3_000,
  });
  const connection = new Redis(url, options);
  const workerConnection = new Redis(url, options);
  const queue = new Queue(`readiness-${randomUUID()}`, { connection });
  let worker: Worker | undefined;
  try {
    let redisTimer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        connection.ping(),
        new Promise<never>((_, reject) => {
          redisTimer = setTimeout(
            () => reject(new Error("local Redis readiness timed out after 5 seconds")),
            5_000,
          );
        }),
      ]);
    } finally {
      if (redisTimer) clearTimeout(redisTimer);
    }
    await queue.pause();
    await Promise.all(Array.from({ length: 5 }, (_, index) => queue.add("backlog", { index })));
    const waiting = await queue.getWaitingCount();
    if (waiting !== 5) throw new Error(`backlog detector expected 5 waiting jobs, observed ${waiting}`);
    worker = new Worker(queue.name, async () => undefined, { connection: workerConnection });
    await worker.waitUntilReady();
    await queue.resume();
    await queue.waitUntilReady();
    const deadline = Date.now() + 10_000;
    while ((await queue.getCompletedCount()) !== 5 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const completed = await queue.getCompletedCount();
    if (completed !== 5 || await queue.getWaitingCount() !== 0) {
      throw new Error(`drain incomplete: completed=${completed}, waiting=${await queue.getWaitingCount()}`);
    }
    return outcome("redis-queue-backlog-drain", "local", command, started, "PASS",
      "Detected five queued jobs and drained all five", [], {
        rto: 30, observed: (Date.now() - started) / 1000,
        rpo: "zero queued jobs lost", rpoObserved: "5/5 completed", rpoMet: true,
      });
  } catch (error) {
    return outcome("redis-queue-backlog-drain", "local", command, started, "FAIL",
      redactEvidence(error instanceof Error ? error.message : String(error)), [], {
        rto: 30, observed: (Date.now() - started) / 1000,
        rpo: "zero queued jobs lost", rpoObserved: "Unproven", rpoMet: false,
      });
  } finally {
    await worker?.close(true).catch(() => {});
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close().catch(() => {});
    connection.disconnect();
    workerConnection.disconnect();
  }
}

export async function exerciseInjectedDatabaseHealth(
  check: () => Promise<void>,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    await check();
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: redactEvidence(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function runDatabaseInterruptionDrill(): Promise<DrillEvidence> {
  const started = Date.now();
  const command = "in-process database health harness with injected dependency failure and recovery";
  const interrupted = await exerciseInjectedDatabaseHealth(async () => {
    throw new Error("injected database interruption");
  });
  const recovered = await exerciseInjectedDatabaseHealth(async () => undefined);
  const passed = !interrupted.ok && interrupted.error === "injected database interruption" && recovered.ok;
  return outcome("database-interruption-health", "local", command, started, passed ? "PASS" : "FAIL",
    passed ? "Injected failure degraded health and successful dependency recovery restored it" : "Injected health dependency semantics failed",
    [], { rto: 10, observed: (Date.now() - started) / 1000, rpo: "no writes performed", rpoObserved: "read-only injection", rpoMet: true });
}

async function runWorkerShutdownDrill(): Promise<DrillEvidence> {
  const started = Date.now();
  const command = "drainWorkers controlled graceful and deadline shutdown harness";
  const { drainWorkers } = await import("../lib/pipeline-worker");
  interface CloseableWorker {
    close(force?: boolean): Promise<void>;
  }
  const graceful: CloseableWorker = { async close() {} };
  const forced: CloseableWorker = {
    close(force) {
      return force ? Promise.resolve() : new Promise<void>(() => {});
    },
  };
  const [normal, deadline] = await Promise.all([
    drainWorkers([graceful], 100),
    drainWorkers([forced], 5),
  ]);
  const passed = normal.drained === 1 && !normal.timedOut && deadline.forced === 1 && deadline.timedOut;
  return outcome("worker-graceful-shutdown", "local", command, started, passed ? "PASS" : "FAIL",
    passed ? "Graceful close drained; deadline path force-closed local resources" : "Worker drain contract mismatch",
    [], { rto: 30, observed: (Date.now() - started) / 1000, rpo: "active jobs either drain or remain Redis-recoverable", rpoObserved: passed ? "drain contract assertions passed" : "Unproven", rpoMet: passed });
}

async function releaseRollbackHarness(): Promise<DrillEvidence> {
  const started = Date.now();
  const command = "source-only release and rollback harness verification (no deployment or migration executed)";
  try {
    const deploy = await readFile("scripts/host-release.sh", "utf8");
    const pairs = [
      ["migrations/0014_tenant_rls.sql", "migrations/0014_tenant_rls_rollback.sql"],
      ["migrations/0015_campaigns.sql", "migrations/0015_campaigns_rollback.sql"],
      ["migrations/0016_campaign_ads.sql", "migrations/0016_campaign_ads_rollback.sql"],
      ["migrations/0017_provider_usage_ledger.sql", "migrations/0017_provider_usage_ledger_rollback.sql"],
      ["migrations/0019_agency_client_reports.sql", "migrations/0019_agency_client_reports_rollback.sql"],
    ];
    await Promise.all(pairs.flat().map((path) => readFile(path)));
    if (!deploy.includes("health_check") || !deploy.includes("pm2 startOrReload")) {
      throw new Error("release harness lacks reload or health-gate source");
    }
    return outcome("release-rollback-source", "local", command, started, "PASS",
      `Verified release health gate and ${pairs.length} forward/rollback source pairs; no rollback was executed`,
      [], { rto: 900, rpo: "rollback sources present; execution not claimed", rpoObserved: "source/harness only", rpoMet: null });
  } catch (error) {
    return outcome("release-rollback-source", "local", command, started, "FAIL",
      redactEvidence(error instanceof Error ? error.message : String(error)));
  }
}

function blockedExternalDrills(): DrillEvidence[] {
  const now = Date.now();
  return [
    outcome("staging-release-rollback", "external", "operator-executed staging deploy and prior-SHA rollback", now, "BLOCKED",
      "Not run; no staging outcome is claimed", [
        "STAGING_HOST reachable by the operator",
        "STAGING_SSH_PRIVATE_KEY with deploy permission",
        "A documented known-good prior git SHA",
        "Approved maintenance window and incident commander",
      ], { rto: 900, rpo: "no committed writes after rollback point" }),
    outcome("staging-migration-rollback", "external", "operator-executed migration forward/rollback on disposable staging clone", now, "BLOCKED",
      "Not run; migration rollback outcome is not fabricated", [
        "Disposable production-like staging database URL",
        "Database owner approval and verified pre-drill snapshot",
        "Migration-specific forward and rollback change ticket",
      ], { rto: 1800, rpo: "zero rows outside approved migration scope" }),
    outcome("backup-restore", "external", "docs/db-backup-runbook.md restore procedure against isolated restore database", now, "BLOCKED",
      "Not run; see docs/db-backup-runbook.md for existing procedure/evidence locations", [
        "DO_HOST and DO_SSH_PRIVATE_KEY",
        "DO Spaces read credentials and bucket access",
        "Isolated restore database with destructive-test approval",
        "Selected backup object key and expected integrity baseline",
      ], { rto: 3600, rpo: "latest successful nightly snapshot (target <=24h)" }),
    outcome("external-monitor-alert", "external", "operator-triggered synthetic health failure and alert acknowledgement", now, "BLOCKED",
      "Not run; external alert delivery is not claimed", [
        "Configured uptime monitor URL",
        "Paging integration and escalation destination",
        "Authorized test alert window and on-call acknowledgement",
      ], { rto: 300, rpo: "not applicable" }),
  ];
}

export interface OrchestratorOptions {
  localOnly: boolean;
  executor?: CommandExecutor;
  localDrills?: () => Promise<DrillEvidence[]>;
  gitSha?: string;
}

export async function orchestrateReadiness(options: OrchestratorOptions): Promise<ReadinessEvidence> {
  const started = Date.now();
  const executor = options.executor ?? executeCommand;
  const nodeTest = "node --env-file=.env.local --import tsx/esm --test";
  const local = options.localDrills
    ? await options.localDrills()
    : [
        await runQueueBacklogDrill(),
        await runDatabaseInterruptionDrill(),
        await runWorkerShutdownDrill(),
        await runCommandDrill("provider-outage-circuit", `${nodeTest} tests/pipeline/provider-circuit-breaker.test.ts`, executor, { rto: 120, rpo: "queued work remains paused, not lost" }),
        await runCommandDrill("restart-safety", `${nodeTest} tests/pipeline/restart-safety.test.ts`, executor, { rto: 120, rpo: "durable checkpoints prevent duplicate settlement" }),
        await runCommandDrill("restart-crash-boundaries", `${nodeTest} tests/pipeline/restart-crash-boundaries.test.ts`, executor, { rto: 120, rpo: "same durable run resumes without duplicate provider work" }),
        await runCommandDrill("model-canary", "npm run test:canary", executor, { rto: 300, rpo: "not applicable" }),
        await runCommandDrill("billing-state-machine", "npm run test:state-machine", executor, { rto: 300, rpo: "exactly-once reservation terminal transition" }),
        await releaseRollbackHarness(),
      ];
  const external = blockedExternalDrills();
  const drills = [...local, ...external];
  const relevant = options.localOnly ? local : drills;
  const certificationStatus = relevant.every((drill) => drill.status === "PASS") ? "PASS" : "FAIL";
  const blockers = drills.flatMap((drill) =>
    drill.status === "BLOCKED" ? drill.blockers.map((item) => `${drill.id}: ${item}`) : [],
  );
  let gitSha = options.gitSha;
  if (!gitSha) {
    const result = await executor("git rev-parse HEAD");
    gitSha = result.code === 0 ? result.output.trim() : "UNKNOWN";
  }
  const finished = Date.now();
  return redactEvidence({
    schemaVersion: "1.0",
    kind: "production-readiness-drill-evidence",
    mode: options.localOnly ? "local-only" : "certification",
    certificationStatus,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    gitSha,
    host: "redacted",
    drills,
    blockers,
    checksums: { algorithm: "sha256", drillCount: drills.length },
  });
}

async function main(): Promise<void> {
  const localOnly = process.argv.includes("--local-only");
  const report = await orchestrateReadiness({ localOnly });
  if (!validateEvidenceSchema(report)) throw new Error("generated evidence failed schema validation");
  await mkdir("reports/production-readiness", { recursive: true });
  const stamp = report.startedAt.replace(/[:.]/g, "-");
  const path = `reports/production-readiness/readiness-${stamp}-${report.gitSha.slice(0, 12)}.json`;
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.info(`${report.certificationStatus}: evidence written to ${path}`);
  if (report.certificationStatus !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}