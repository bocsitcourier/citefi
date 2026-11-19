import test from "node:test";
import assert from "node:assert/strict";
import { recordTrialFailure, trialFailureDiagnostic } from "../lib/trial/diagnostics";

test("trial diagnostics allowlist metadata and never serialize exception contents", () => {
  const error = { message: "Secret prompt customer@example.test https://private.test/?token=secret",
    code: "raw-private-key", status: 401, stack: "private-stack", cause: { code: "42P01", message: "secret" } };
  const event = trialFailureDiagnostic(error, "generate", {
    trialDocumentId: 7, sponsorTeamId: 9, extra: "secret",
  } as { trialDocumentId: number; sponsorTeamId: number });
  assert.equal(event.category, "unclassified_failure");
  assert.equal(event.databaseCode, "42P01");
  assert.equal(event.errorStatus, 401);
  assert.match(event.reference, /^[a-f0-9-]{36}$/);
  assert.equal(event.trialDocumentId, 7);
  assert.doesNotMatch(JSON.stringify(event), /secret|private|customer|extra/i);
});

test("known configuration errors retain safe actionable categories", () => {
  for (const [message, category] of [
    ["The free article sponsor has not been provisioned.", "sponsor_not_provisioned"],
    ["Free article pricing is unavailable within its sponsor budget.", "sponsor_pricing_unavailable"],
    ["Article trial configuration unavailable.", "trial_session_configuration_unavailable"],
    ["The article generator is not configured.", "generator_not_configured"],
    ["Incomplete provider article; automatic replay blocked", "incomplete_provider_article"],
  ]) assert.equal(trialFailureDiagnostic(new Error(message), "session").category, category);
  assert.equal(trialFailureDiagnostic(null, "customer-private-value").operation, "request");
  assert.equal(trialFailureDiagnostic({}, "request", { trialDocumentId: 0, sponsorTeamId: -1 }).sponsorTeamId, undefined);
  const accounting = trialFailureDiagnostic({
    code: "PROVIDER_ATTEMPT_ACCOUNTING_FAILED", cause: { status: 503, message: "private provider response" },
  }, "generation_outcome");
  assert.equal(accounting.providerFailureCode, "PROVIDER_ATTEMPT_ACCOUNTING_FAILED");
  assert.equal(accounting.errorStatus, 503);
  assert.doesNotMatch(JSON.stringify(accounting), /private/);
});

test("console evidence and its reference survive a broken persistence sink", async t => {
  const lines: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { lines.push(args); });
  const event = trialFailureDiagnostic(new Error("private details"), "generation_outcome");
  assert.equal(await recordTrialFailure(event, async () => { throw new Error("private database error"); }), event.reference);
  assert.equal(lines.length, 2);
  assert.doesNotMatch(JSON.stringify(lines), /private/);
  let saved = false;
  await recordTrialFailure(event, async data => { assert.equal(data.reference, event.reference); saved = true; });
  assert.equal(saved, true);
});

test("a stalled diagnostic sink does not leave the customer request hanging", async t => {
  const lines: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { lines.push(args); });
  const event = trialFailureDiagnostic(new Error("private"), "session");
  const reference = await recordTrialFailure(event, () => new Promise<void>(() => {}), 1);
  assert.equal(reference, event.reference);
  assert.match(JSON.stringify(lines), /diagnostic-persistence-pending/);
  assert.doesNotMatch(JSON.stringify(lines), /private/);
});
