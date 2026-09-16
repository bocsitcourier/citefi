import assert from "node:assert/strict";
import test from "node:test";
import { classifyError } from "../lib/errors";
import { runWithTenantContext } from "../lib/tenant-context";

for (const code of [
  "PROVIDER_ATTEMPT_NOT_DURABLE",
  "PROVIDER_ATTEMPT_USAGE_UNAVAILABLE",
  "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
  "PROVIDER_ATTEMPT_SUBMISSION_UNCERTAIN",
  "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
]) {
  test(`${code} preserves the terminal worker reconciliation policy`, () => {
    const error = Object.assign(new Error("timeout 503 provider response"), { code });
    const classified = classifyError(error, "text_gen");
    assert.equal(classified.disposition, "fatal");
    assert.equal(classified.code, "PROVIDER_ACCOUNTING_FAILED");
    assert.equal(classified.cause, error);
    assert.equal(classified.message.includes("timeout 503"), false);
  });
}

test("post-response attribution failures cannot enter a provider retry loop", async () => {
  const { logCostTelemetry, isProviderAccountingError } = await import("../lib/cost-telemetry");
  await runWithTenantContext(
    { actorType: "worker", userId: null, teamId: 7, role: "admin" },
    async () => {
      await assert.rejects(logCostTelemetry(
        { teamId: 8, operationType: "other", provider: "gemini", model: "fixture-model" },
        { inputTokens: 2, outputTokens: 1, totalTokens: 3 }, 1,
      ), (error: unknown) => {
        assert.equal(isProviderAccountingError(error), true);
        assert.equal(classifyError(error).disposition, "fatal");
        return true;
      });
    },
  );
});