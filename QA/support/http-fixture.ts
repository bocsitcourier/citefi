/**
 * TypeScript launch entrypoint for the owned HTTP fixture.
 *
 * The route-handler implementation lives in http-fixture.mjs so the contract
 * can also be imported by a plain Node harness.  The isolated harness invokes
 * this file through tsx/esm and waits for the READY line before starting the
 * HTTP suites.
 */
import {
  createHttpFixtureServer,
  stopHttpFixtureServer,
  HTTP_FIXTURE_URL,
  HTTP_FIXTURE_PORT,
} from "./http-fixture.mjs";

const server = await createHttpFixtureServer();
console.log(`QA_HTTP_FIXTURE_READY ${HTTP_FIXTURE_URL}`);
console.log(`QA_HTTP_FIXTURE_URL=${HTTP_FIXTURE_URL}`);
console.log(`QA_HTTP_FIXTURE_PORT=${HTTP_FIXTURE_PORT}`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await stopHttpFixtureServer(server);
}

process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));