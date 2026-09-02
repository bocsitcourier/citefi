import type Redis from "ioredis";

export const WORKER_READINESS_KEY = "ops:worker:readiness:v1";
export const WORKER_READINESS_VERSION = 1;

export interface WorkerReadinessState {
  version: number;
  ready: boolean;
  releaseVersion: string;
  startedAt: string;
  registeredAt: string | null;
  updatedAt: string;
  requiredRegistrations: Record<string, boolean>;
  requiredSchedulers: Record<string, boolean>;
  disabledSchedulers: Record<string, string>;
  modelsReady: boolean;
  failureReason: string | null;
}

const requiredRegistrations = ["pipeline-workers"];
const requiredSchedulers = [
  "job-monitor",
  "provider-circuit",
  "spend-breaker",
  "scheduled-content",
  "canary",
  "reservation-sweeper",
  "brief",
  "job-recovery",
  "stripe-credit-reconciliation",
];

function initialState(): WorkerReadinessState {
  const now = new Date().toISOString();
  return {
    version: WORKER_READINESS_VERSION,
    ready: false,
    releaseVersion: process.env.RELEASE_SHA ?? process.env.GIT_SHA ?? "unknown",
    startedAt: now,
    registeredAt: null,
    updatedAt: now,
    requiredRegistrations: Object.fromEntries(requiredRegistrations.map((name) => [name, false])),
    requiredSchedulers: Object.fromEntries(requiredSchedulers.map((name) => [name, false])),
    disabledSchedulers: {},
    modelsReady: false,
    failureReason: null,
  };
}

async function write(redis: Redis, state: WorkerReadinessState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await redis.set(WORKER_READINESS_KEY, JSON.stringify(state));
}

export async function beginWorkerReadiness(redis: Redis): Promise<void> {
  await write(redis, initialState());
}

export async function readWorkerReadiness(redis: Redis): Promise<WorkerReadinessState | null> {
  const raw = await redis.get(WORKER_READINESS_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as WorkerReadinessState;
    return value.version === WORKER_READINESS_VERSION ? value : null;
  } catch {
    return null;
  }
}

async function update(
  redis: Redis,
  mutate: (state: WorkerReadinessState) => void,
): Promise<WorkerReadinessState> {
  const state = (await readWorkerReadiness(redis)) ?? initialState();
  state.disabledSchedulers ??= {};
  mutate(state);
  const registrationsReady = Object.values(state.requiredRegistrations).every(Boolean);
  const schedulersReady = Object.values(state.requiredSchedulers).every(Boolean);
  state.ready = registrationsReady && schedulersReady && state.modelsReady && !state.failureReason;
  if (state.ready && !state.registeredAt) state.registeredAt = new Date().toISOString();
  await write(redis, state);
  return state;
}

/** Pipeline registration code may call this as each required group completes. */
export async function markWorkerRegistration(
  redis: Redis,
  name: string,
  ready = true,
): Promise<WorkerReadinessState> {
  return update(redis, (state) => {
    state.requiredRegistrations[name] = ready;
  });
}

export async function markWorkerScheduler(
  redis: Redis,
  name: string,
  ready = true,
): Promise<WorkerReadinessState> {
  return update(redis, (state) => {
    state.requiredSchedulers[name] = ready;
    if (ready) delete state.disabledSchedulers[name];
  });
}

export async function markWorkerSchedulerDisabled(
  redis: Redis,
  name: string,
  reason: string,
): Promise<WorkerReadinessState> {
  return update(redis, (state) => {
    state.requiredSchedulers[name] = false;
    state.disabledSchedulers[name] = reason.replace(/[\r\n\t]+/g, " ").slice(0, 160);
  });
}

export function canaryAccountingIsRequired(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === "production" ||
    env.READINESS_CERTIFICATION === "true" ||
    env.DEPLOY_ENVIRONMENT === "production" ||
    env.DEPLOY_ENVIRONMENT === "staging";
}

export function canaryAccountingIsConfigured(
  value = process.env.CANARY_ACCOUNTING_TEAM_ID,
): boolean {
  const teamId = value == null || value.trim() === "" ? Number.NaN : Number(value);
  return Number.isInteger(teamId) && teamId > 0;
}

export function isDevelopmentCanaryOnlyUnready(
  state: WorkerReadinessState,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (canaryAccountingIsRequired(env)) return false;
  const unreadySchedulers = Object.entries(state.requiredSchedulers)
    .filter(([, ready]) => !ready)
    .map(([name]) => name);
  return state.failureReason == null &&
    state.modelsReady &&
    Object.values(state.requiredRegistrations).every(Boolean) &&
    unreadySchedulers.length === 1 &&
    unreadySchedulers[0] === "canary" &&
    Boolean(state.disabledSchedulers?.canary);
}

export async function markWorkerModelsReady(redis: Redis): Promise<WorkerReadinessState> {
  return update(redis, (state) => {
    state.modelsReady = true;
  });
}

export async function failWorkerReadiness(redis: Redis, reason: unknown): Promise<void> {
  const message = reason instanceof Error ? reason.message : String(reason);
  await update(redis, (state) => {
    state.failureReason = message.replace(/[\r\n\t]+/g, " ").slice(0, 160);
    state.ready = false;
  });
}

export async function clearWorkerReadiness(redis: Redis): Promise<void> {
  await redis.del(WORKER_READINESS_KEY).catch(() => {});
}