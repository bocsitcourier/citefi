/** Dedicated test-only Redis endpoint; never use the application's REDIS_URL. */
import { spawn } from "node:child_process";
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
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  let stopTimer: NodeJS.Timeout | undefined;
  const stopTimeout = new Promise<void>((resolve) => {
    stopTimer = setTimeout(resolve, 1_000);
  });
  child.kill("SIGTERM");
  await Promise.race([exited, stopTimeout]);
  if (stopTimer) clearTimeout(stopTimer);
}

const REDIS_READY_MESSAGE = /ready to accept connections/i;
const REDIS_PORT_IN_USE_MESSAGE =
  /address already in use|could not create server tcp listening socket|failed to listen/i;

function startupFailure(output: string, reason: string): Error {
  const details = output.trim().replace(/\s+/g, " ").slice(-1_000);
  return new Error(
    `Failed to start isolated Redis on ${ISOLATED_TEST_REDIS_HOST}:${ISOLATED_TEST_REDIS_PORT}: ` +
      `${reason}${details ? ` (${details})` : ""}`,
  );
}

/**
 * Redis has to prove that the child process bound the endpoint before any
 * client is constructed. A successful TCP connection alone is not ownership:
 * if the child lost a bind race, it could connect to a pre-existing Redis and
 * destructive test commands would target somebody else's state.
 */
async function waitForOwnedRedisReady(
  child: ReturnType<typeof spawn>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = "";
    let settled = false;
    let readinessCheck: NodeJS.Immediate | undefined;
    const startupTimeout = setTimeout(() => {
      finish(
        startupFailure(
          output,
          "redis-server did not report readiness before the startup timeout",
        ),
      );
    }, 10_000);

    const cleanup = () => {
      clearTimeout(startupTimeout);
      if (readinessCheck) clearImmediate(readinessCheck);
      child.stdout?.off("data", onOutput);
      child.stderr?.off("data", onOutput);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    const onOutput = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (!REDIS_READY_MESSAGE.test(output) || readinessCheck) return;

      // Give a same-turn exit event a chance to win before accepting the
      // readiness handshake. This is important for a child that logs a line
      // and then immediately dies during startup.
      readinessCheck = setImmediate(() => {
        readinessCheck = undefined;
        if (child.exitCode !== null) {
          finish(
            startupFailure(
              output,
              `redis-server exited before ownership was established (code ${child.exitCode})`,
            ),
          );
          return;
        }
        finish();
      });
    };

    const onError = (error: Error) => {
      finish(startupFailure(output, `redis-server could not be spawned: ${error.message}`));
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const reason = REDIS_PORT_IN_USE_MESSAGE.test(output)
        ? "the port is already in use by another process"
        : `redis-server exited before readiness (code ${code ?? "unknown"}${
            signal ? `, signal ${signal}` : ""
          })`;
      finish(startupFailure(output, reason));
    };

    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);
    child.once("error", onError);
    child.once("exit", onExit);
  });
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
      "--loglevel",
      "notice",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let connection: Redis | undefined;
  try {
    await waitForOwnedRedisReady(child);
    if (child.exitCode !== null) {
      throw new Error(
        `Isolated Redis exited before connection on ${ISOLATED_TEST_REDIS_HOST}:${ISOLATED_TEST_REDIS_PORT}`,
      );
    }
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