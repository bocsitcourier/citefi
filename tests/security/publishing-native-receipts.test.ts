import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyNativeReceipt } from "../../lib/publishing/receipt-policy";
import { hashApiKey } from "../../lib/publishing/auth/hmac";
import * as ledger from "../../packages/apex-receiver/src/services/publishing-receipts";

test("native durable receiver ledger supplies signed accepted/rejected proof and keeps crash/missing receipts unknown", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "owned-receipt-ledger-"));
  const config = { apiKey: "offline-fixture-receiver-key", baseUrl: "https://example.invalid", storagePath: path.join(temp, "uploads"), publishingReceiptFenceReady: true };
  const claimSubmission = (binding: ledger.SubmissionBinding) => ledger.claimSubmission(binding, config);
  const finishSubmission = (binding: ledger.SubmissionBinding, outcome: "accepted" | "not_accepted", url?: string) => ledger.finishSubmission(binding, outcome, config, url);
  const readNativeReceipt = (id: string, attempt: string) => ledger.readNativeReceipt(id, attempt, config);
  const submissionBinding = (body: Record<string, unknown>) => ledger.submissionBinding(body, config);
  try {
    const attempt = new Date(Date.now() - 1000);
    const binding = () => ({ jobId: randomUUID(), dispatchAttempt: attempt.toISOString(),
      contentHash: "a".repeat(64), receiverOrigin: "https://example.invalid" });
    const accepted = binding(), rejected = binding(), crashed = binding();
    const job = (value: typeof accepted) => ({ publicId: value.jobId, lastAttemptAt: attempt,
      errorDetails: { dispatchContract: { version: 1, hash: value.contentHash, submissionStarted: true,
        receiverOrigin: value.receiverOrigin, receiverKeyHash: hashApiKey(config.apiKey) } } });
    const payload = submissionBinding({ ...accepted, title: "Do not persist content", media: ["private"] });
    assert.deepEqual(payload, accepted);
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimSubmission(accepted)));
    assert.equal(claims.filter(Boolean).length, 1);
    await finishSubmission(accepted, "accepted", "https://example.invalid/published");
    const proof = await readNativeReceipt(accepted.jobId, accepted.dispatchAttempt);
    assert.ok(proof);
    assert.equal(verifyNativeReceipt(proof.raw, proof.signature, config.apiKey, job(accepted)).receipt.outcome, "accepted");
    assert.equal(await claimSubmission(accepted), false);
    assert.equal(await claimSubmission({ ...accepted, dispatchAttempt: new Date().toISOString() }), false);
    await assert.rejects(finishSubmission(accepted, "not_accepted"));
    assert.equal(await claimSubmission(rejected), true);
    await finishSubmission(rejected, "not_accepted");
    const negative = await readNativeReceipt(rejected.jobId, rejected.dispatchAttempt);
    assert.ok(negative);
    assert.equal(verifyNativeReceipt(negative.raw, negative.signature, config.apiKey, job(rejected)).receipt.operationFenced, true);
    assert.equal(await claimSubmission(rejected), false);
    assert.equal(await claimSubmission(crashed), true);
    await assert.rejects(ledger.finishSubmission(crashed, "not_accepted",
      { ...config, publishingReceiptFenceReady: false }), /outcome remains unknown/);
    assert.equal(await readNativeReceipt(crashed.jobId, crashed.dispatchAttempt), null);
    assert.equal(await claimSubmission(crashed), false);
    assert.equal(await readNativeReceipt(randomUUID(), attempt.toISOString()), null);
    assert.equal(await readNativeReceipt(accepted.jobId, new Date().toISOString()), null);
    await assert.rejects(readNativeReceipt("../../outside", attempt.toISOString()));
    assert.throws(() => submissionBinding({ ...accepted, receiverOrigin: "https://foreign.invalid" }));
    assert.equal(submissionBinding({ jobId: randomUUID() }), null);
    assert.equal((await fs.readdir(path.join(temp, ".publishing-operations"))).length, 3);
    await assert.rejects(fs.access(path.join(temp, "uploads", ".publishing-operations")));
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
test("receiver checks remain pinned bounded authenticated GETs and never follow redirects or touch generation accounting", () => {
  const service = readFileSync("lib/publishing/reconciliation.ts", "utf8");
  assert.match(service, /safeFetchWithRedirects\(target/);
  assert.match(service, /method: "GET", maxRedirects: 0/);
  assert.match(service, /timeoutMs: 5000, deadlineMs: 5000, maxBytes: 32768/);
  assert.match(service, /publishing-receipt-read-v1/);
  assert.match(service, /live_read_authorized[\s\S]*safeFetchWithRedirects/);
  assert.doesNotMatch(service, /releaseCredits|cancelReservation|settleReservation|creditReservations|usageEvents|providerAttempt/);
  const route = readFileSync("app/api/publishing/jobs/[id]/reconciliation/route.ts", "utf8");
  assert.match(route, /withAuthenticatedTeamAdminContext/);
  assert.match(route, /authorizeLiveRead: z.literal\(true\)/);
  const nativeRoute = readFileSync("packages/apex-receiver/src/routes/publishing-receipts.ts", "utf8");
  assert.match(nativeRoute, /router.get/);
  assert.doesNotMatch(nativeRoute, /claimSubmission|finishSubmission|writeFile|router.post/);
});
