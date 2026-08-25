import type Redis from "ioredis";

export const WORKER_HEARTBEAT_KEY = "ops:worker:heartbeat";
export const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;
export const WORKER_HEARTBEAT_TTL_SECONDS = 90;

let timer: NodeJS.Timeout | null = null;

export async function writeWorkerHeartbeat(redis: Redis): Promise<void> {
  await redis.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), "EX", WORKER_HEARTBEAT_TTL_SECONDS);
}

export async function startWorkerHeartbeat(redis: Redis): Promise<void> {
  if (timer) return;
  await writeWorkerHeartbeat(redis);
  timer = setInterval(() => {
    void writeWorkerHeartbeat(redis).catch((error) =>
      console.warn("[worker-heartbeat] update failed:", error instanceof Error ? error.message.slice(0, 120) : "unknown error")
    );
  }, WORKER_HEARTBEAT_INTERVAL_MS);
  timer.unref();
}

export async function stopWorkerHeartbeat(redis: Redis): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await redis.del(WORKER_HEARTBEAT_KEY).catch(() => {});
}