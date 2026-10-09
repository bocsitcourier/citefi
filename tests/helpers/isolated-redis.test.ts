import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { test } from "node:test";
import {
  ISOLATED_TEST_REDIS_HOST,
  ISOLATED_TEST_REDIS_PORT,
  startIsolatedRedis,
} from "./isolated-redis";

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(
      ISOLATED_TEST_REDIS_PORT,
      ISOLATED_TEST_REDIS_HOST,
      () => resolve(),
    );
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("occupied Redis port is rejected without contacting the foreign listener", async () => {
  let connectionCount = 0;
  let receivedBytes = 0;
  const foreignListener = createServer((socket) => {
    connectionCount += 1;
    socket.on("data", (chunk) => {
      receivedBytes += chunk.length;
    });
  });

  await listen(foreignListener);
  try {
    await assert.rejects(
      startIsolatedRedis(),
      /port is already in use by another process/i,
    );
    assert.equal(connectionCount, 0);
    assert.equal(receivedBytes, 0);
    assert.deepEqual(foreignListener.address(), {
      address: ISOLATED_TEST_REDIS_HOST,
      family: "IPv4",
      port: ISOLATED_TEST_REDIS_PORT,
    });
  } finally {
    await close(foreignListener);
  }
});
