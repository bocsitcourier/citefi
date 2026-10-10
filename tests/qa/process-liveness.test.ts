import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GET } from "../../app/api/health/live/route";

test("process liveness explicitly does not certify readiness", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "alive",
    scope: "process-only",
    readiness: "not-assessed",
  });
});

test("dev warmup uses liveness while deployment retains operational health", () => {
  const bootstrap = readFileSync("server/index.ts", "utf8");
  assert.match(bootstrap, /fetch\(`\$\{BASE_URL\}\/api\/health\/live`/);
  const release = readFileSync("scripts/host-release.sh", "utf8");
  assert.match(release, /\/api\/health/);
  assert.doesNotMatch(release, /\/api\/health\/live/);
});
