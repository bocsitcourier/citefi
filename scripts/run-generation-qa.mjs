#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mode = args.length === 0 ? "sandbox" : args.length === 1 ? args[0].replace(/^--mode=/, "") : "";
if (!["sandbox", "live", "auto"].includes(mode)) {
  console.error("Usage: npm run test:e2e -- [--mode=sandbox|--mode=live|--mode=auto]");
  process.exit(2);
}
if (mode !== "sandbox") {
  console.error(JSON.stringify({
    requestedMode: mode, resolvedMode: null, status: "BLOCKED",
    reason: "A deployed live QA runner with dedicated account, workspace, credit budget and destination approvals is not configured. No silent sandbox fallback.",
    realProviderCalls: 0,
  }));
  process.exit(2);
}
console.log(JSON.stringify({
  requestedMode: mode, resolvedMode: "sandbox", scope: "Offline policy regressions and owned route/worker generation fixtures",
  productionCertified: false, realProviderCalls: 0,
}));
const suites = [
  "tests/security/url-validation-independent.test.ts",
  "tests/security/url-validation-ssrf-regression.test.mjs",
  "tests/security/publishing-scheduling-hardening.test.ts",
  "tests/security/role-hardening.test.mjs",
  "tests/security/cost-hardening.admin-adjustment.test.ts",
  "tests/security/cost-hardening.scheduled.test.ts",
];
const result = spawnSync("bash", ["QA/support/run-offline.sh", "--", ...suites], {
  cwd: root, stdio: "inherit",
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
for (const fixture of [
  { file: "tests/qa/article-full-chain.test.ts", ports: "5110,55490,16390", guard: "./QA/support/article-chain-network.mjs" },
  { file: "tests/qa/media-route-worker-fullchain.test.ts", ports: "55488,16388", guard: "./QA/support/offline-guard.mjs" },
]) {
  console.log(JSON.stringify({ phase: fixture.file, mode: "sandbox", productionCertified: false }));
  const chain = spawnSync(process.execPath, [
    "--import", fixture.guard,
    "--import", "tsx/esm", "--test", "--test-concurrency=1", fixture.file,
  ], {
    cwd: root, stdio: "inherit",
    env: {
      PATH: process.env.PATH, HOME: "/tmp", NODE_ENV: "test",
      WORKER_PROCESS: "true", QA_TEST_ALLOWED_PORTS: fixture.ports,
      LIVE_QA_IMAGE: "0",
      GEMINI_API_KEY: "fixture-no-network",
      OPENAI_API_KEY: "fixture-no-network",
      GOOGLE_API_KEY: "fixture-no-network",
    },
  });
  if (chain.error || chain.status !== 0) {
    console.error(chain.error?.message ?? `${fixture.file} failed`);
    process.exit(chain.status ?? 1);
  }
}
