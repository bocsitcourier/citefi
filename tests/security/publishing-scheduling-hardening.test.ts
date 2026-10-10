import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { calculateNextRun } from "../../lib/schedule-time";
import { validateSocialSchedule } from "../../lib/social-scheduling";
import { callbackStateUpdate } from "../../lib/publishing/callback-state";
import { articleThinkingConfig, articleThinkingOptions, articleLengthInstruction } from "../../lib/article-request-policy";
import { GoogleGenAI } from "@google/genai";
import { preservesCreditCommitments } from "../../lib/billing-adjustment-policy";
import { extractGeminiRequestLimits } from "../../lib/gemini-attempt-receipt";

const now = new Date("2026-10-08T13:01:00Z");

test("schedule calculation respects the configured timezone and cadence", () => {
  assert.equal(calculateNextRun("0 9 * * *", "America/New_York", now).toISOString(), "2026-10-09T13:00:00.000Z");
  assert.equal(calculateNextRun("*/15 * * * *", "UTC", now).toISOString(), "2026-10-08T13:15:00.000Z");
});
test("invalid cron or timezone fails visibly rather than scheduling a fallback", () => {
  assert.throws(() => calculateNextRun("invalid", "UTC", now), /Invalid cron/);
  assert.throws(() => calculateNextRun("* * * * *", "Invalid/Zone", now), /timezone/);
});
test("social scheduling rejects past dates and terminal posts", () => {
  for (const status of ["POSTED", "DELETED"]) assert.throws(() => validateSocialSchedule("2026-10-09T13:00:00Z", status, now), /Cannot schedule/);
  assert.throws(() => validateSocialSchedule("2026-10-07T13:00:00Z", "DRAFT", now), /future/);
  assert.throws(() => validateSocialSchedule("invalid", "DRAFT", now), /future/);
  assert.equal(validateSocialSchedule("2026-10-09T13:00:00Z", "DRAFT", now).getUTCDate(), 9);
});
test("negative callbacks require reconciliation rather than another physical send", () => {
  for (const status of ["failure", "partial", "retryable"] as const) {
    const retry = callbackStateUpdate({ status: "sent", attempts: 0, maxAttempts: 3 }, status, undefined, now)!;
    assert.equal(retry.status, "outcome_unknown");
    assert.equal(retry.nextRetryAt, null);
    const exhausted = callbackStateUpdate({ status: "sent", attempts: 2, maxAttempts: 3 }, status, undefined, now)!;
    assert.equal(exhausted.status, "outcome_unknown");
    assert.equal(exhausted.nextRetryAt, null);
  }
});
test("late negative callbacks cannot regress delivered jobs", () => {
  for (const status of ["success", "failure", "partial", "retryable"] as const) {
    assert.equal(callbackStateUpdate({ status: "delivered", attempts: 1, maxAttempts: 3 }, status, undefined, now), null);
  }
  const success = callbackStateUpdate({ status: "outcome_unknown", attempts: 3, maxAttempts: 3 }, "success", undefined, now)!;
  assert.equal(success.status, "delivered");
  assert.equal(success.nextRetryAt, null);
});
test("publishing response, duplicate dispatch, and callback receipt races are fenced in source", () => {
  const publisher = readFileSync("lib/publishing/index.ts", "utf8");
  assert.match(publisher, /const claimed = await runWithSystemContext[\s\S]*db\.transaction/);
  assert.match(publisher, /assertBoundReview\(tx, currentArticle, currentConnection/);
  assert.match(publisher, /membership !== contract\.publisherMembership/);
  assert.match(publisher, /eq\(publishingJobs\.status, 'pending'\)/);
  assert.ok((publisher.match(/eq\(publishingJobs\.status, 'processing'\)/g) ?? []).length >= 2);
  assert.match(publisher, /currentConnection\.deletedAt.*currentConnection\.status !== 'active'/);
  const callback = readFileSync("app/api/publishing/callbacks/route.ts", "utf8");
  assert.match(callback, /db\.transaction[\s\S]*\.for\('update'\)[\s\S]*eq\(publishingCallbacks\.payload, parsed\.data\)[\s\S]*tx\.insert[\s\S]*callbackStateUpdate/);
});
test("both scheduling entry points share the same tenant-scoped conditional write", () => {
  for (const path of ["app/api/social_posts/[id]/route.ts", "app/api/social_posts/schedule/route.ts"]) {
    assert.match(readFileSync(path, "utf8"), /await scheduleSocialPost\(/);
  }
  const source = readFileSync("lib/social-scheduling.ts", "utf8");
  assert.match(source, /eq\(socialPosts\.teamId, teamId\)/);
  assert.match(source, /eq\(socialPosts\.status, expectedStatus\)/);
  assert.match(source, /CURRENT_TIMESTAMP/);
});
test("scheduled dispatch records one durable run and honors terminal provider errors", () => {
  const source = readFileSync("lib/scheduled-content-worker.ts", "utf8");
  assert.match(source, /systemDb\.transaction[\s\S]*tx\.insert\(scheduleRuns\)[\s\S]*return \{ schedule, run \}/);
  assert.equal((source.match(/\.insert\(scheduleRuns\)/g) ?? []).length, 1);
  assert.match(source, /isProviderAttemptTerminalError\(error\)/);
});
test("late publishing replies and exceptions are fenced to their dispatch attempt", () => {
  const source = readFileSync("lib/publishing/index.ts", "utf8");
  assert.match(source, /returning\(\{ id: publishingJobs\.id, lastAttemptAt: publishingJobs\.lastAttemptAt \}\)/);
  assert.equal((source.match(/eq\(publishingJobs\.lastAttemptAt, claimAt\)/g) ?? []).length, 4);
  assert.match(source, /claimAt \? eq\(publishingJobs\.status, 'processing'\) : inArray\(publishingJobs\.status, \['pending', 'queued'\]\)/);
  assert.match(source, /markJobFailed\(job\.id, error, 'PUBLISH_ERROR', claimAt, submissionStarted\)/);
});
test("manual credit corrections cannot over-remove a bucket and falsify its ledger delta", () => {
  const balance = { allowanceCredits: 100, purchasedCredits: 0, allowanceUsed: 0, purchasedUsed: 0, allowanceDebt: 0, purchasedDebt: 0, reservedCredits: 0 };
  assert.equal(preservesCreditCommitments(balance, "allowance", -101), false);
  assert.equal(preservesCreditCommitments(balance, "allowance", -100), true);
});
test("article requests control thinking by model family without changing output limits", () => {
  assert.equal(articleThinkingConfig("gemini-3.5-flash")?.thinkingLevel, "LOW");
  assert.equal(articleThinkingConfig("gemini-2.5-flash")?.thinkingBudget, 1024);
  assert.equal(articleThinkingConfig("unrecognized-model"), undefined);
  assert.match(articleLengthInstruction(800, 1400), /COMPLETE article including headings and FAQs/);
  assert.match(articleLengthInstruction(800, 1400), /Markdown hyperlinks/);
  assert.throws(() => articleLengthInstruction(1400, 800), /Invalid/);
  assert.equal(extractGeminiRequestLimits({ maxOutputTokens: 16384, ...articleThinkingOptions("gemini-3.5-flash") }).thinkingLevel, "LOW");
});
test("installed SDK serializes thinking level without dropping schema or token ceiling", async () => {
  const original = globalThis.fetch;
  let captured: any;
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const client = new GoogleGenAI({ apiKey: "owned-offline-fixture", httpOptions: { baseUrl: "https://sdk-fixture.invalid" } });
    await client.models.generateContent({
      model: "gemini-3.5-flash", contents: "fixture",
      config: {
        maxOutputTokens: 16384, responseMimeType: "application/json",
        responseSchema: { type: "object", properties: { articleText: { type: "string" } } },
        ...articleThinkingOptions("gemini-3.5-flash"),
      },
    });
    assert.equal(captured.generationConfig.thinkingConfig.thinkingLevel, "LOW");
    assert.equal(captured.generationConfig.maxOutputTokens, 16384);
    assert.equal(captured.generationConfig.responseMimeType, "application/json");
    assert.ok(captured.generationConfig.responseSchema.properties.articleText);
  } finally { globalThis.fetch = original; }
});
