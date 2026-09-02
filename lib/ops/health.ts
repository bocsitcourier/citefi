export type CheckStatus = "ok" | "degraded" | "fail" | "skipped";

export interface HealthCheck {
  ok: boolean;
  status: CheckStatus;
  latencyMs?: number;
  message?: string;
  [key: string]: unknown;
}

export interface QueueDepth {
  waiting: number;
  active: number;
  failed: number;
}

export interface HealthThresholds {
  timeoutMs: number;
  databaseLatencyWarnMs: number;
  workerStaleMs: number;
  queueWaitingWarn: number;
  queueWaitingFail: number;
  queueActiveWarn: number;
  queueFailedWarn: number;
  queueFailedFail: number;
  backupStaleMs: number;
  criticalErrorWarn: number;
  criticalErrorFail: number;
}

export interface StatusFile {
  state?: string;
  status?: string;
  timestamp?: string;
  completedAt?: string;
  updatedAt?: string;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export interface HealthDependencies {
  now?: () => number;
  database: () => Promise<void>;
  redis: () => Promise<void>;
  workerHeartbeat: () => Promise<string | null>;
  workerReadiness: () => Promise<{
    ready: boolean;
    registeredAt: string | null;
    releaseVersion: string;
    requiredRegistrations: Record<string, boolean>;
    requiredSchedulers: Record<string, boolean>;
    disabledSchedulers?: Record<string, string>;
    modelsReady: boolean;
    failureReason: string | null;
  } | null>;
  queues: () => Promise<Record<string, QueueDepth>>;
  providerCircuits: () => Promise<unknown>;
  canary: () => Promise<{
    result: Record<string, unknown>;
    health: { ok: boolean; stale: boolean; reason: string | null };
  }>;
  storage: () => Promise<{ configured: boolean; providers?: Record<string, boolean> }>;
  models: () => Promise<{ ready: boolean; message?: string; details?: unknown }>;
  backupStatus: () => Promise<StatusFile | null>;
  deploymentStatus: () => Promise<StatusFile | null>;
  recentCriticalErrors: (since: Date) => Promise<number>;
}

export interface CapabilityPolicy {
  mediaEnabled: boolean;
  storageRequired: boolean;
  backupRequired: boolean;
  modelsRequired: boolean;
}

export function capabilityPolicyFromEnv(): CapabilityPolicy {
  const mediaEnabled = process.env.MEDIA_FEATURES_ENABLED !== "false";
  return {
    mediaEnabled,
    storageRequired: mediaEnabled,
    backupRequired: process.env.BACKUP_REQUIRED !== "false",
    modelsRequired: process.env.AI_FEATURES_ENABLED !== "false",
  };
}

export interface HealthReport {
  status: "healthy" | "degraded" | "unhealthy";
  ok: boolean;
  timestamp: string;
  services: Record<string, unknown>;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  timeoutMs: 3_000,
  databaseLatencyWarnMs: 1_000,
  workerStaleMs: 90_000,
  queueWaitingWarn: 100,
  queueWaitingFail: 1_000,
  queueActiveWarn: 100,
  queueFailedWarn: 25,
  queueFailedFail: 250,
  backupStaleMs: 36 * 60 * 60 * 1_000,
  criticalErrorWarn: 1,
  criticalErrorFail: 10,
};

const numberEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

export function healthThresholdsFromEnv(): HealthThresholds {
  return {
    timeoutMs: numberEnv("HEALTH_CHECK_TIMEOUT_MS", DEFAULT_HEALTH_THRESHOLDS.timeoutMs),
    databaseLatencyWarnMs: numberEnv("HEALTH_DB_LATENCY_WARN_MS", DEFAULT_HEALTH_THRESHOLDS.databaseLatencyWarnMs),
    workerStaleMs: numberEnv("HEALTH_WORKER_STALE_MS", DEFAULT_HEALTH_THRESHOLDS.workerStaleMs),
    queueWaitingWarn: numberEnv("HEALTH_QUEUE_WAITING_WARN", DEFAULT_HEALTH_THRESHOLDS.queueWaitingWarn),
    queueWaitingFail: numberEnv("HEALTH_QUEUE_WAITING_FAIL", DEFAULT_HEALTH_THRESHOLDS.queueWaitingFail),
    queueActiveWarn: numberEnv("HEALTH_QUEUE_ACTIVE_WARN", DEFAULT_HEALTH_THRESHOLDS.queueActiveWarn),
    queueFailedWarn: numberEnv("HEALTH_QUEUE_FAILED_WARN", DEFAULT_HEALTH_THRESHOLDS.queueFailedWarn),
    queueFailedFail: numberEnv("HEALTH_QUEUE_FAILED_FAIL", DEFAULT_HEALTH_THRESHOLDS.queueFailedFail),
    backupStaleMs: numberEnv("HEALTH_BACKUP_STALE_MS", DEFAULT_HEALTH_THRESHOLDS.backupStaleMs),
    criticalErrorWarn: numberEnv("HEALTH_CRITICAL_ERRORS_WARN", DEFAULT_HEALTH_THRESHOLDS.criticalErrorWarn),
    criticalErrorFail: numberEnv("HEALTH_CRITICAL_ERRORS_FAIL", DEFAULT_HEALTH_THRESHOLDS.criticalErrorFail),
  };
}

export function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^@\s/]+)@/gi, "$1***@")
    .replace(/\b(api[_-]?key|token|password|secret)=([^&\s]+)/gi, "$1=***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 160);
}

async function timed<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<{ value?: T; latencyMs: number; error?: string }> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
    return { value, latencyMs: Date.now() - started };
  } catch (error) {
    return { latencyMs: Date.now() - started, error: safeMessage(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fileDate(status: StatusFile): number {
  for (const value of [status.completedAt, status.updatedAt, status.timestamp]) {
    const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

export async function collectHealth(
  deps: HealthDependencies,
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
  policy: CapabilityPolicy = { mediaEnabled: true, storageRequired: true, backupRequired: true, modelsRequired: true },
): Promise<HealthReport> {
  const now = deps.now?.() ?? Date.now();
  const timeout = thresholds.timeoutMs;
  const [database, redis, heartbeat, readiness, queues, circuits, canary, storage, models, backup, deployment, errors] =
    await Promise.all([
      timed(deps.database, timeout, "database"),
      timed(deps.redis, timeout, "redis"),
      timed(deps.workerHeartbeat, timeout, "worker heartbeat"),
      timed(deps.workerReadiness, timeout, "worker readiness"),
      timed(deps.queues, timeout, "queues"),
      timed(deps.providerCircuits, timeout, "provider circuits"),
      timed(deps.canary, timeout, "canary"),
      timed(deps.storage, timeout, "storage"),
      timed(deps.models, timeout, "models"),
      timed(deps.backupStatus, timeout, "backup status"),
      timed(deps.deploymentStatus, timeout, "deployment status"),
      timed(() => deps.recentCriticalErrors(new Date(now - 60 * 60 * 1_000)), timeout, "critical errors"),
    ]);

  const dbCheck: HealthCheck = database.error
    ? { ok: false, status: "fail", latencyMs: database.latencyMs, message: database.error }
    : {
        ok: true,
        status: database.latencyMs > thresholds.databaseLatencyWarnMs ? "degraded" : "ok",
        latencyMs: database.latencyMs,
      };
  const redisCheck: HealthCheck = redis.error
    ? { ok: false, status: "fail", latencyMs: redis.latencyMs, message: redis.error }
    : { ok: true, status: "ok", latencyMs: redis.latencyMs };

  const heartbeatAt = heartbeat.value ? Date.parse(heartbeat.value) : Number.NaN;
  const heartbeatAgeMs = Number.isFinite(heartbeatAt) ? Math.max(0, now - heartbeatAt) : null;
  const workerReady = readiness.value;
  const disabledWorkerReason = workerReady?.disabledSchedulers
    ? Object.entries(workerReady.disabledSchedulers)
        .map(([name, reason]) => `${name}: ${reason}`)
        .join("; ")
    : "";
  const workerCheck: HealthCheck = heartbeat.error || readiness.error
    ? { ok: false, status: "fail", message: heartbeat.error ?? readiness.error }
    : !workerReady?.ready
      ? { ok: false, status: "fail", message: workerReady?.failureReason ?? (disabledWorkerReason || "Worker registrations or schedulers are not ready"), readiness: workerReady ?? null }
    : heartbeatAgeMs === null || heartbeatAgeMs > thresholds.workerStaleMs
      ? { ok: false, status: "fail", message: "Worker heartbeat is missing or stale", lastHeartbeatAt: heartbeat.value ?? null, ageMs: heartbeatAgeMs }
      : { ok: true, status: "ok", lastHeartbeatAt: heartbeat.value, ageMs: heartbeatAgeMs };

  const queueResults: Record<string, HealthCheck & QueueDepth> = {};
  if (queues.value) {
    for (const [name, counts] of Object.entries(queues.value)) {
      const failed = counts.waiting >= thresholds.queueWaitingFail || counts.failed >= thresholds.queueFailedFail;
      const degraded = counts.waiting >= thresholds.queueWaitingWarn ||
        counts.active >= thresholds.queueActiveWarn || counts.failed >= thresholds.queueFailedWarn;
      queueResults[name] = { ...counts, ok: !failed, status: failed ? "fail" : degraded ? "degraded" : "ok" };
    }
  }
  const queueCheck: HealthCheck = queues.error
    ? { ok: false, status: "fail", message: queues.error, queues: queueResults }
    : {
        ok: !Object.values(queueResults).some((q) => q.status === "fail"),
        status: Object.values(queueResults).some((q) => q.status === "fail")
          ? "fail"
          : Object.values(queueResults).some((q) => q.status === "degraded") ? "degraded" : "ok",
        queues: queueResults,
      };

  const circuitValue = circuits.value as Record<string, { status?: string }> | undefined;
  const openCircuit = circuitValue && Object.values(circuitValue).some((item) => item?.status === "open");
  const safeCircuits = circuitValue && Object.fromEntries(Object.entries(circuitValue).map(([provider, item]) => {
    const detail = item as Record<string, unknown>;
    return [provider, {
      provider,
      status: detail.status,
      failures: detail.failures,
      openedAt: detail.openedAt,
      queues: detail.queues,
      lastProbeAt: detail.lastProbeAt,
      ...(detail.lastProbeError ? { lastProbeError: safeMessage(detail.lastProbeError) } : {}),
    }];
  }));
  const circuitCheck: HealthCheck = circuits.error
    ? { ok: false, status: "fail", message: circuits.error }
    : { ok: !openCircuit, status: openCircuit ? "fail" : "ok", details: safeCircuits };
  const canaryCheck: HealthCheck = canary.error
    ? { ok: false, status: "fail", message: canary.error }
    : {
        ...canary.value!.result,
        error: canary.value!.result.error ? safeMessage(canary.value!.result.error) : null,
        canaryStatus: canary.value!.result.status,
        ok: canary.value!.health.ok,
        status: canary.value!.health.ok ? "ok" : "fail",
        stale: canary.value!.health.stale,
        health_reason: canary.value!.health.reason,
      };

  const storageCheck: HealthCheck = storage.error
    ? { ok: false, status: "fail", message: storage.error }
    : !policy.mediaEnabled
      ? { ok: true, status: "skipped", configured: storage.value?.configured ?? false, enabled: false, reason: "disabled-by-policy", providers: storage.value?.providers ?? {} }
    : !storage.value?.configured
      ? { ok: !policy.storageRequired, status: policy.storageRequired ? "fail" : "skipped", configured: false, enabled: true, reason: "misconfigured", providers: storage.value?.providers ?? {} }
      : { ok: true, status: "ok", configured: true, providers: storage.value.providers ?? {}, latencyMs: storage.latencyMs };

  const modelsCheck: HealthCheck = models.error
    ? { ok: false, status: policy.modelsRequired ? "fail" : "degraded", message: models.error }
    : !policy.modelsRequired
      ? { ok: true, status: "skipped", enabled: false, reason: "disabled-by-policy" }
      : !models.value?.ready
        ? { ok: false, status: "fail", enabled: true, reason: "misconfigured", message: models.value?.message ?? "Critical model tiers are unresolved", details: models.value?.details }
        : { ok: true, status: "ok", enabled: true, details: models.value.details };

  const backupValue = backup.value;
  const backupState = (backupValue?.state ?? backupValue?.status ?? "").toLowerCase();
  const backupAge = backupValue ? now - fileDate(backupValue) : Number.NaN;
  const backupConfigured = backupValue != null;
  const backupOk = backupConfigured && backupState === "success" && Number.isFinite(backupAge) && backupAge <= thresholds.backupStaleMs;
  const backupCheck: HealthCheck = backup.error
    ? { ok: false, status: "fail", message: backup.error }
    : !backupConfigured
      ? { ok: !policy.backupRequired, status: policy.backupRequired ? "fail" : "skipped", configured: false }
      : { ok: backupOk, status: backupOk ? "ok" : "fail", state: backupState || "unknown", ageMs: Number.isFinite(backupAge) ? backupAge : null };

  const deploymentValue = deployment.value;
  const deployState = (deploymentValue?.state ?? deploymentValue?.status ?? "").toLowerCase();
  const deployOk = deploymentValue != null &&
    ["success", "succeeded", "healthy", "complete", "completed"].includes(deployState);
  const deployInProgress = ["deploying", "verifying", "rolling_back"].includes(deployState);
  const deployRestored = deployState === "rolled_back";
  const deploymentCheck: HealthCheck = deployment.error
    ? { ok: false, status: "fail", message: deployment.error }
    : deploymentValue == null
      ? { ok: true, status: "skipped", configured: false }
      : {
          ok: deployOk || deployInProgress || deployRestored,
          status: deployOk ? "ok" : deployInProgress || deployRestored ? "degraded" : "fail",
          state: deployState || "unknown",
          timestamp: deploymentValue.timestamp ?? deploymentValue.updatedAt ?? null,
        };

  const criticalCount = errors.value ?? 0;
  const criticalCheck: HealthCheck = errors.error
    ? { ok: false, status: "fail", message: errors.error }
    : {
        ok: criticalCount < thresholds.criticalErrorFail,
        status: criticalCount >= thresholds.criticalErrorFail ? "fail" :
          criticalCount >= thresholds.criticalErrorWarn ? "degraded" : "ok",
        count: criticalCount,
        windowMinutes: 60,
      };

  const checks = [dbCheck, redisCheck, workerCheck, queueCheck, circuitCheck, canaryCheck,
    storageCheck, modelsCheck, backupCheck, deploymentCheck, criticalCheck];
  const hasFailure = checks.some((check) => check.status === "fail");
  const hasDegraded = checks.some((check) => check.status === "degraded");
  return {
    status: hasFailure ? "unhealthy" : hasDegraded ? "degraded" : "healthy",
    ok: !hasFailure,
    timestamp: new Date(now).toISOString(),
    services: {
      database: dbCheck,
      redis: redisCheck,
      worker: workerCheck,
      queues: queueCheck,
      providerCircuits: circuitCheck,
      canary: canaryCheck,
      storage: storageCheck,
      models: modelsCheck,
      backup: backupCheck,
      deployment: deploymentCheck,
      recentCriticalErrors: criticalCheck,
    },
  };
}