/**
 * Safe-local measured BullMQ/pipeline-worker load.
 *
 * This uses one Redis process owned by this test on 127.0.0.1:16386.  It
 * exercises the production createPipelineWorker/createPipelineHandler control
 * flow without PostgreSQL, provider SDKs, customer data, or external traffic.
 * The lease scenario injects the real ArticleRunLeaseConflictError boundary;
 * it is intentionally separate from the already-retained restart 8/8 run.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { performance } from "node:perf_hooks";
import { after, before, test } from "node:test";

import { Queue } from "bullmq";
import Redis from "ioredis";

import {
  ArticleRunLeaseConflictError,
  createPipelineWorker,
} from "../../lib/pipeline-worker";

if (process.env.QA_LOAD_SAFE_LOCAL !== "true") {
  throw new Error(
    "load queue QA requires QA/support/load-local.sh (safe-local guard)",
  );
}
if (process.env.QA_LOAD_NO_DATABASE !== "true") {
  throw new Error("load queue QA must explicitly run in no-database mode");
}

const REDIS_HOST = "127.0.0.1";
const REDIS_PORT = 16386;
const REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}/15`;

type OwnedRedis = {
  process: ReturnType<typeof spawn>;
  connection: Redis;
};

let ownedRedis: OwnedRedis | undefined;

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: REDIS_HOST, port });
    let finished = false;
    const finish = (value: boolean) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(300, () => finish(false));
  });
}

function connection(): Redis {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 1_000,
    retryStrategy: (attempt) => (attempt < 80 ? 25 : null),
  });
  // The owning test observes readiness through ping; keep startup failures
  // attached instead of allowing an unhandled ioredis error event.
  client.on("error", () => undefined);
  return client;
}

async function startOwnedRedis(): Promise<OwnedRedis> {
  if (await probePort(REDIS_PORT)) {
    throw new Error(
      `refusing load test: 127.0.0.1:${REDIS_PORT} is already in use`,
    );
  }
  const child = spawn(
    "redis-server",
    [
      "--bind",
      REDIS_HOST,
      "--port",
      String(REDIS_PORT),
      "--save",
      "",
      "--appendonly",
      "no",
      "--daemonize",
      "no",
    ],
    { stdio: "ignore" },
  );
  let redis: Redis | undefined;
  try {
    await once(child, "spawn");
    redis = connection();
    await redis.ping();
    return { process: child, connection: redis };
  } catch (error) {
    redis?.disconnect();
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => undefined);
    throw error;
  }
}

async function stopOwnedRedis(): Promise<void> {
  const current = ownedRedis;
  ownedRedis = undefined;
  if (!current) return;
  await current.connection.quit().catch(() => current.connection.disconnect());
  if (current.process.exitCode === null) {
    current.process.kill("SIGTERM");
    await once(current.process, "exit").catch(() => undefined);
  }
}

function snapshot() {
  const usage = process.memoryUsage();
  return { rss: usage.rss, heapUsed: usage.heapUsed };
}

function percentile(values: number[], fraction: number): number {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

async function waitForTerminal(
  queue: Queue,
  count: number,
  timeoutMs = 30_000,
): Promise<{ completed: number; failed: number }> {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    const counts = await queue.getJobCounts(
      "completed",
      "failed",
      "active",
      "waiting",
      "delayed",
    );
    const completed = counts.completed ?? 0;
    const failed = counts.failed ?? 0;
    if (completed + failed >= count) return { completed, failed };
    if (performance.now() >= deadline) {
      throw new Error(
        `queue did not terminalize ${count} jobs within ${timeoutMs}ms ` +
          `(completed=${completed}, failed=${failed})`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

async function runQueueCase(
  scenario: "success" | "lease_expiry",
  concurrency: number,
) {
  const queueName = `qa-load-${scenario}-${concurrency}-${Date.now()}`;
  const queueConnection = connection();
  const workerConnection = connection();
  const queue = new Queue(queueName, {
    connection: queueConnection,
    defaultJobOptions: {
      removeOnComplete: false,
      removeOnFail: false,
    },
  });
  let processorCalls = 0;
  let releaseCalls = 0;
  const latencyByJob = new Map<string, number>();
  const startedAtByJob = new Map<string, number>();
  const rssBefore = snapshot();
  const startedAt = performance.now();
  let worker:
    | {
        waitUntilReady: () => Promise<unknown>;
        close: (force?: boolean) => Promise<void>;
      }
    | undefined;

  try {
    const pipelineWorker = createPipelineWorker<{ index: number }>(
      queueName,
      async (job) => {
        processorCalls += 1;
        const jobId = String(job.id);
        latencyByJob.set(jobId, performance.now() - (startedAtByJob.get(jobId) ?? startedAt));
        if (scenario === "lease_expiry") {
          throw new ArticleRunLeaseConflictError(
            `QA injected expired durable lease for ${jobId}`,
          );
        }
        return { accepted: true, jobId };
      },
      {
        stage: "qa_load",
        execution: {
          scope: "system",
          reason: `safe-local queue load ${scenario}`,
        },
        getBilling: () => ({
          teamId: 7,
          runId: `qa-load-billing-${scenario}-${concurrency}`,
        }),
        _deps: {
          // A lease-expiry delivery must never refund its still-owned hold.
          releaseReservation: async () => {
            releaseCalls += 1;
          },
          recordProviderFailure: async () => undefined,
        },
        _workerOptions: {
          connection: workerConnection,
          lockDuration: 5_000,
          stalledInterval: 1_000,
        },
      },
    );
    worker = pipelineWorker;
    await pipelineWorker.waitUntilReady();
    const jobs = Array.from({ length: concurrency }, (_, index) => {
      const jobId = `qa-load-${scenario}-${concurrency}-${index}`;
      startedAtByJob.set(jobId, performance.now());
      return queue.add(
        "qa-load",
        { index },
        {
          jobId,
          attempts: 1,
          removeOnComplete: false,
          removeOnFail: false,
        },
      );
    });
    await Promise.all(jobs);
    const terminal = await waitForTerminal(queue, concurrency);
    const durationMs = performance.now() - startedAt;
    const latencies = [...latencyByJob.values()];
    assert.equal(processorCalls, concurrency);
    assert.equal(
      terminal.completed,
      scenario === "success" ? concurrency : 0,
      `${scenario}/${concurrency}: completed count`,
    );
    assert.equal(
      terminal.failed,
      scenario === "lease_expiry" ? concurrency : 0,
      `${scenario}/${concurrency}: failed count`,
    );
    if (scenario === "lease_expiry") {
      assert.equal(
        releaseCalls,
        0,
        "lease-expiry control flow must preserve the reservation",
      );
    }
    const rssAfter = snapshot();
    return {
      scenario,
      concurrency,
      durationMs,
      p50Ms: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      throughputRequestsPerSecond: concurrency / Math.max(durationMs / 1_000, 0.000001),
      logicalRequests: concurrency,
      completed: terminal.completed,
      failed: terminal.failed,
      processorCalls,
      releaseCalls,
      rssBeforeBytes: rssBefore.rss,
      rssAfterBytes: rssAfter.rss,
      rssDeltaBytes: rssAfter.rss - rssBefore.rss,
      heapUsedBeforeBytes: rssBefore.heapUsed,
      heapUsedAfterBytes: rssAfter.heapUsed,
      heapUsedDeltaBytes: rssAfter.heapUsed - rssBefore.heapUsed,
    };
  } finally {
    await worker?.close(true).catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close().catch(() => undefined);
    await Promise.all([
      queueConnection.quit().catch(() => queueConnection.disconnect()),
      workerConnection.quit().catch(() => workerConnection.disconnect()),
    ]);
  }
}

before(async () => {
  ownedRedis = await startOwnedRedis();
  await ownedRedis.connection.flushdb();
});

after(async () => {
  await stopOwnedRedis();
});

test(
  "measured 1/10/100 production queue processor load and lease-expiry fault",
  { timeout: 120_000 },
  async () => {
    assert.ok(ownedRedis, "the test must own its Redis fixture");
    const measurements = [];
    for (const concurrency of [1, 10, 100]) {
      measurements.push(await runQueueCase("success", concurrency));
      measurements.push(await runQueueCase("lease_expiry", concurrency));
    }
    console.log(
      `LOAD_RESULT ${JSON.stringify({
        kind: "production-bullmq-pipeline-worker",
        mode: "owned-local-redis",
        redis: `${REDIS_HOST}:${REDIS_PORT}`,
        database: "not-used",
        measurements,
        faultScenario: "real ArticleRunLeaseConflictError control flow",
      })}`,
    );
  },
);