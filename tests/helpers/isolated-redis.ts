/** Dedicated test-only Redis endpoint; never use the application's REDIS_URL. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import Redis, { type RedisOptions } from "ioredis";

export const ISOLATED_TEST_REDIS_PORT = 16379;
export const ISOLATED_TEST_REDIS_HOST = "127.0.0.1";

export function isolatedRedisUrl(database = 0): string {
  return `redis://${ISOLATED_TEST_REDIS_HOST}:${ISOLATED_TEST_REDIS_PORT}/${database}`;
}

/**
 * Return a connection that can only target the dedicated QA endpoint. Do not
 * read REDIS_URL here: a real application queue must never be touched by a
 * queue-ID test.
 */
export function getConnection(overrides: RedisOptions = {}): Redis {
  const connection = new Redis({
    host: ISOLATED_TEST_REDIS_HOST,
    port: ISOLATED_TEST_REDIS_PORT,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 2_000,
    retryStrategy: () => null,
    ...overrides,
  });
  // The owning test observes connection readiness through ping(). Prevent
  // transient startup retries from becoming unhandled ioredis error events.
  connection.on("error", () => undefined);
  return connection;
}

export interface IsolatedRedis {
  connection: Redis;
  stop: () => Promise<void>;
}

async function stopOwnedProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  if (child.exitCode === null) await once(child, "exit").catch(() => undefined);
}

/**
 * Start and own one ephemeral Redis process for a real queue contract test.
 * A test must call stop() in its finally block; this helper never discovers
 * or terminates a process it did not spawn.
 */
export async function startIsolatedRedis(database = 0): Promise<IsolatedRedis> {
  const child = spawn(
    "redis-server",
    [
      "--bind",
      ISOLATED_TEST_REDIS_HOST,
      "--port",
      String(ISOLATED_TEST_REDIS_PORT),
      "--save",
      "",
      "--appendonly",
      "no",
      "--daemonize",
      "no",
    ],
    { stdio: "ignore" },
  );

  let connection: Redis | undefined;
  try {
    await once(child, "spawn");
    connection = getConnection({
      db: database,
      retryStrategy: (attempt) => (attempt < 40 ? 50 : null),
    });
    await connection.ping();
    const readyConnection = connection;

    return {
      connection: readyConnection,
      stop: async () => {
        await readyConnection.quit().catch(() => readyConnection.disconnect());
        await stopOwnedProcess(child);
      },
    };
  } catch (error) {
    await connection?.quit().catch(() => connection?.disconnect());
    await stopOwnedProcess(child);
    throw error;
  }
}