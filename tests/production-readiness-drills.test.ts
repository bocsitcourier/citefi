import assert from "node:assert/strict";
import test from "node:test";
import {
  orchestrateReadiness,
  redactEvidence,
  validateEvidenceSchema,
  type DrillEvidence,
} from "../scripts/run-production-readiness-drills";

function drill(status: "PASS" | "FAIL" | "BLOCKED", scope: "local" | "external" = "local"): DrillEvidence {
  return {
    id: "injected",
    scope,
    status,
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    durationMs: 1,
    command: "injected",
    summary: "injected",
    rto: { targetSeconds: 1, observedSeconds: 0.001, met: true },
    rpo: { target: "zero", observed: "zero", met: true },
    blockers: status === "BLOCKED" ? ["credential required"] : [],
    checksumSha256: "a".repeat(64),
  };
}

test("evidence redaction removes secret keys, URL credentials, assignments, and bearer tokens", () => {
  const redacted = redactEvidence({
    password: "plain",
    nested: {
      message: "DATABASE_URL=postgresql://user:pass@db.example/app Authorization Bearer abc.def https://bucket.test/item?X-Amz-Signature=signed-value&token=query-token",
      redis: "redis://default:hunter2@localhost:6379/0",
    },
  });
  assert.equal(redacted.password, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(redacted), /plain|pass@|hunter2|abc\.def|signed-value|query-token/);
  assert.match(redacted.nested.message, /DATABASE_URL=\[REDACTED\]/);
});

test("orchestrator emits schema-valid evidence and certification fails on a local failure", async () => {
  const report = await orchestrateReadiness({
    localOnly: true,
    gitSha: "abc123",
    localDrills: async () => [drill("PASS"), drill("FAIL")],
  });
  assert.equal(validateEvidenceSchema(report), true);
  assert.equal(report.certificationStatus, "FAIL");
});

test("blocked credential-dependent drills fail certification but not explicit local-only mode", async () => {
  const certified = await orchestrateReadiness({
    localOnly: false,
    gitSha: "abc123",
    localDrills: async () => [drill("PASS")],
  });
  assert.equal(certified.certificationStatus, "FAIL");
  assert.ok(certified.drills.some((entry) => entry.scope === "external" && entry.status === "BLOCKED"));
  assert.ok(certified.blockers.some((entry) => entry.includes("STAGING_HOST")));

  const local = await orchestrateReadiness({
    localOnly: true,
    gitSha: "abc123",
    localDrills: async () => [drill("PASS")],
  });
  assert.equal(local.certificationStatus, "PASS");
});

test("local-only still fails when a local drill is blocked", async () => {
  const report = await orchestrateReadiness({
    localOnly: true,
    gitSha: "abc123",
    localDrills: async () => [drill("BLOCKED")],
  });
  assert.equal(report.certificationStatus, "FAIL");
});