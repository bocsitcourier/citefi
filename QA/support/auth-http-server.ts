/**
 * Keep the isolated route-handler fixture alive for a short manual/API
 * observation pass. This is intentionally separate from the node:test entry
 * point so normal QA always tears down its database and Redis processes.
 *
 * Run:
 *   node --import tsx/esm \
 *     --experimental-loader ./tests/scope-0-alias-loader.mjs \
 *     QA/support/auth-http-server.ts
 */
import { startAuthHttpFixture } from "./auth-http-fixture.js";

const fixture = await startAuthHttpFixture();
console.log(
  `auth-http fixture ready: ${fixture.baseUrl} ` +
  `(postgres=127.0.0.1:55485 redis=127.0.0.1:16385; synthetic accounts are seeded by the QA test)`,
);

const shutdown = async () => {
  await fixture.stop();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
await new Promise<void>(() => undefined);