import { spawn } from "node:child_process";
import { once } from "node:events";
import { preflight } from "../QA/support/live-media-budget.mjs";

const [mode = "preflight", runId] = process.argv.slice(2);

if (mode === "preflight") {
  if (runId) throw new Error("Preflight takes no run ID");
  console.log(JSON.stringify(preflight(), null, 2));
  process.exit(0);
}

if (mode !== "run" || !runId || !/^[a-z0-9-]{1,80}$/.test(runId)) {
  throw new Error("Usage: node scripts/qa-live-image.mjs [preflight | run <unique-run-id>]");
}
if (!process.env.GEMINI_API_KEY) {
  throw new Error("Live image QA requires a runtime-injected GEMINI_API_KEY; .env.local is never loaded");
}
if (process.env.GEMINI_API_KEY === "fixture-no-network") {
  throw new Error("Live image QA refuses the offline fixture provider key");
}

// Preflight before allocating any QA services. The test independently repeats
// preflight and reserves the same shared lock immediately before its one route
// submission, after owned PostgreSQL/Redis have been bootstrapped.
const report = preflight();
console.log(JSON.stringify(report, null, 2));
const child = spawn(process.execPath, [
  "--import", "tsx/esm",
  "--test",
  "--test-name-pattern=row 10: authenticated identity route",
  "tests/qa/media-route-worker-fullchain.test.ts",
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    LIVE_QA_IMAGE: "1",
    LIVE_QA_IMAGE_RUN_ID: runId,
  },
  stdio: "inherit",
});
child.once("error", (error) => {
  console.error("Could not start the owned image QA harness:", error.message);
  process.exitCode = 1;
});
const [code, signal] = await once(child, "exit");
if (signal) {
  console.error(`Owned image QA harness stopped by ${signal}; reconcile the shared budget lock if a submission may have started.`);
  process.exitCode = 1;
} else {
  process.exitCode = Number(code ?? 1);
}
