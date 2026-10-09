import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { connect } from "node:net";
import https from "node:https";

test("offline runner supplies only dead database/provider fixtures", () => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.WORKER_PROCESS, "true");
  for (const key of ["DATABASE_URL", "NEON_DATABASE_URL", "DATABASE_POOLED_URL"]) {
    const url = new URL(process.env[key]);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "1");
    assert.equal(url.username, "");
    assert.equal(url.password, "");
  }
  assert.equal(process.env.OPENAI_API_KEY, "qa-offline-openai-fixture");
  assert.equal(process.env.GEMINI_API_KEY, "qa-offline-gemini-fixture");
  for (const key of ["ADMIN_RECOVERY_PASSWORD", "STRIPE_SECRET_KEY", "SMTP_PASSWORD",
    "AWS_ACCESS_KEY_ID", "GOOGLE_APPLICATION_CREDENTIALS", "TEST_BASE_URL",
    "QA_HTTP_FIXTURE_URL", "QA_ISOLATED_DATABASE"]) {
    assert.equal(process.env[key], undefined, `${key} must not be inherited`);
  }
  assert.match(process.env.HOME, /citefi-offline\./);
});

test("real TCP and TLS clients reject non-fixture targets before connection", () => {
  assert.throws(() => connect({ host: "127.0.0.1", port: 5000 }), /QA_OFFLINE_NETWORK_BLOCKED/);
  assert.throws(() => connect({ host: "provider.invalid", port: 443 }), /QA_OFFLINE_NETWORK_BLOCKED/);
  assert.throws(() => https.get("https://provider.invalid"), /QA_OFFLINE_NETWORK_BLOCKED/);
});

test("routine package and workflow entries cannot restore app-backed commands", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  for (const [name, command] of Object.entries(scripts)) {
    if (name !== "test" && !name.startsWith("test:")) continue;
    assert.doesNotMatch(command, /--env-file|localhost:5000|127\.0\.0\.1:6379|redis-server|scripts\/migrate/);
    assert.match(command, /QA\/support\/(?:run-offline|with-isolated-database)\.sh|npm run test:/);
  }
  const config = readFileSync(".replit", "utf8");
  for (const command of ["test:auth", "test:approval-links", "test:admin-notifications", "test:budget-stop"]) {
    assert.ok(config.includes(`args = "npm run ${command}"`));
  }
  const project = config.split('name = "Project"')[1].split("[[workflows.workflow]]")[0];
  assert.doesNotMatch(project, /args = "(?:.*tests|Push to GitHub)"/);
});