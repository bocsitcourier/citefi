import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { EVIDENCE_ROOT, hash, sharedBudget } from "../../QA/support/selected-media-plan.mjs";
import { reserveSelectedMediaRun } from "../../QA/support/selected-media-run.mjs";
import { reserveVideoRecoveryRun } from "../../QA/support/video-recovery-run.mjs";
import { loadRecoverySources, recoveryManifest, assertRecoveryPermission,
  validateRecoveryApproval, validateParentTerminationProof } from "../../QA/support/video-recovery-plan.mjs";
import { installVideoRecoveryNetworkGuard } from "../../QA/support/video-recovery-network.mjs";

function isolated(t) {
  const root = mkdtempSync(resolve(tmpdir(), "video-recovery-test-"));
  const baselineBytes = JSON.stringify({
    version: 1, ceilingUsd: 30, knownPriorUsd: 0.517071,
    historicalHoldUsd: 6, historicalCalls: "UNKNOWN / UNRECONCILED",
  }, null, 2) + "\n";
  writeFileSync(resolve(root, "budget-baseline.json"), baselineBytes);
  writeFileSync(resolve(root, "budget.lock"), JSON.stringify({
    runId: "live-selected-video-20261008", stage: "video", synthetic: true,
  }));
  writeFileSync(resolve(root, "budget-ledger.json"), JSON.stringify({
    version: 2, ceilingUsd: 30,
    budgetBaseline: { sourceSha256: hash(baselineBytes) },
    runs: [
      { runId: "live-selected-video-20261008", stage: "video", state: "pending",
        reservedUsd: 6.3, actualUsd: null, calls: [] },
      { runId: "live-selected-podcast-20261008", stage: "podcast", state: "settled",
        reservedUsd: 0.65, actualUsd: 0.042284, calls: [] },
    ],
  }, null, 2));
  const podcast = resolve(root, "live-selected-podcast-20261008");
  mkdirSync(podcast);
  writeFileSync(resolve(podcast, "outcome.json"), JSON.stringify({ endToEndPass: true }));
  writeFileSync(resolve(podcast, "export-before-cleanup.json"), JSON.stringify({ cleanupPermitted: true }));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const proof = () => ({ runId: "live-selected-video-20261008", simulated: true,
  controllerTerminated: true, ownedProcessTreeStopped: true, matchingProcessesAbsent: true });
const reserve = (root, options = {}) => reserveVideoRecoveryRun("pilot", "offline-pilot", { root, offline: true, parentProof: proof(), ...options });
const body = { instances: [{ prompt: "frozen scene" }],
  parameters: { sampleCount: 1, durationSeconds: 6, resolution: "720p", aspectRatio: "16:9" } };
const url = "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning";
const receipt = { sourceEventId: "fixture-attempt-1", teamId: 810, attempt: 1,
  model: "veo-3.1-fast-generate-preview", operationType: "veo_clip",
  requestMetadata: { requestKey: "veo-idea-video:scene-1" } };
function configure(run) {
  run.frozenPrompts = { 1: "frozen scene" }; run.ownedTeamId = 810; return run;
}
function post(payload = body) { return { method: "POST", body: JSON.stringify(payload) }; }
function accept(run) {
  const call = run.submit("clip", { ...body, model: receipt.model }, receipt.sourceEventId);
  run.capture(call, { providerRequestId: "fixture-operation" }, 600000);
  run.writeBytes("call-1-native.mp4", Buffer.alloc(1100, 1));
  run.acceptClip(call, { fullDecode: true, width: 1280, height: 720, duration: 6 },
    { sourceEventId: receipt.sourceEventId, status: "accounted", costMicrousd: 600000, creditReservationId: 1 });
  return call;
}
test("offline sources are authentic, qualified and cannot mutate retained root", () => {
  const s = loadRecoverySources(); assert.equal(s.script.clips.length, 10); assert.equal(s.inventory.historicalScriptAndSpeechMicrousd, 46806);
  assert.equal(s.inventory.oldClipAcknowledgementQualification.operationIdsAvailable, false);
  assert.throws(() => reserve(EVIDENCE_ROOT), /isolated/);
  const before = hash(readFileSync(resolve(EVIDENCE_ROOT, "budget-ledger.json")));
  assert.throws(() => reserveVideoRecoveryRun("pilot", "live-denied", { root: EVIDENCE_ROOT, parentProof: proof() }), /ledger dispute unresolved/);
  assert.equal(hash(readFileSync(resolve(EVIDENCE_ROOT, "budget-ledger.json"))), before);
});
test("paid permissions are absent and stale pricing cannot authorize traffic", () => {
  assert.throws(() => assertRecoveryPermission("pilot", EVIDENCE_ROOT, recoveryManifest(), proof()));
});
test("reserve preserves parent hold/lock, normal runners blocked, second child blocked", t => {
  const root = isolated(t), before = readFileSync(resolve(root, "budget.lock"));
  const parent = JSON.stringify(sharedBudget(root).ledger.runs.find(r => r.runId === proof().runId)); reserve(root);
  assert.equal(JSON.stringify(sharedBudget(root).ledger.runs.find(r => r.runId === proof().runId)), parent);
  assert.deepEqual(readFileSync(resolve(root, "budget.lock")), before);
  assert.equal(sharedBudget(root).totalBudget.availableUsd, 16.490645);
  assert.throws(() => reserve(root), /replay|snapshot/);
  assert.throws(() => reserveSelectedMediaRun("video", "normal-blocked", { root, offline: true }), /EEXIST/);
});
for (const faultPoint of ["after-lock", "after-journal", "after-ledger", "before-post"]) {
  test(`crash at ${faultPoint} retains exclusive lock and prevents replay`, t => {
    const root = isolated(t);
    const fault = point => { if (point === faultPoint) throw new Error("simulated process death"); };
    if (faultPoint === "before-post") {
      const run = reserve(root, { fault });
      assert.throws(() => run.submit("clip", body, "event"), /simulated/);
      assert.equal(run.entry.calls.length, 1);
    } else assert.throws(() => reserve(root, { fault }), /simulated/);
    assert.ok(existsSync(resolve(root, "video-recovery.lock")));
    assert.throws(() => reserve(root));
    assert.equal(sharedBudget(root).ledger.runs.find(r => r.runId === proof().runId).reservedUsd, 6.3);
  });
}
for (const option of [
  { parentProof: { ...proof(), ownedProcessTreeStopped: false } },
  { startedAt: Date.now() - 720000 },
]) {
  test("missing termination or exhausted deadline blocks physical submission", t => {
    const root = isolated(t);
    if (!option.parentProof) { const run = reserve(root, option); assert.throws(() => run.submit("clip", body, "event"), /deadline/); }
    else assert.throws(() => reserve(root, option), /termination proof/);
  });
}
test("completion cannot run without paid/accepted/exported pilot", t => {
  const root = isolated(t);
  assert.throws(() => reserveVideoRecoveryRun("completion", "blocked", { root, offline: true, parentProof: proof() }), /pilot/);
});
test("successful pilot releases only its child lock after complete export", t => {
  const root = isolated(t), run = reserve(root); accept(run);
  run.writeEvidence("export-before-cleanup.json", { cleanupPermitted: true });
  assert.equal(run.finish(true), true);
  assert.ok(existsSync(resolve(root, "budget.lock"))); assert.ok(!existsSync(resolve(root, "video-recovery.lock")));
  assert.equal(sharedBudget(root).ledger.runs.at(-1).actualUsd, .6);
});
test("accepted native result without export retains full hold; no next phase", t => {
  const root = isolated(t), run = reserve(root); accept(run);
  assert.equal(run.finish(true), false); assert.equal(sharedBudget(root).ledger.runs.at(-1).state, "pending");
  assert.ok(existsSync(resolve(root, "video-recovery.lock")));
  assert.throws(() => reserveVideoRecoveryRun("completion", "denied", { root, offline: true, parentProof: proof() }));
});
test("ledger divergence is never overwritten", t => {
  const root = isolated(t), run = reserve(root), file = resolve(root, "budget-ledger.json");
  const value = JSON.parse(readFileSync(file)); value.externalWriter = true; writeFileSync(file, JSON.stringify(value));
  assert.throws(() => run.submit("clip", body, "event"), /divergent/);
  assert.equal(JSON.parse(readFileSync(file)).externalWriter, true);
});
for (const [label, payload] of [
  ["different frozen prompt", { ...body, instances: [{ prompt: "not frozen" }] }],
  ["two samples", { ...body, parameters: { ...body.parameters, sampleCount: 2 } }],
  ["1080p", { ...body, parameters: { ...body.parameters, resolution: "1080p" } }],
  ["8s", { ...body, parameters: { ...body.parameters, durationSeconds: 8 } }],
  ["webhook auxiliary", { ...body, webhookConfig: { uris: ["https://example.com"] } }],
]) {
  test(`${label} is refused before transport`, async t => {
    const root = isolated(t), run = configure(reserve(root)); let count = 0;
    const restore = installVideoRecoveryNetworkGuard(() => run, () => receipt, {
      fixtureFetch: async () => { count++; return Response.json({}); } }); t.after(restore);
    await assert.rejects(fetch(url, post(payload)));
    assert.equal(count, 0); assert.equal(run.finish(false), false);
  });
}
for (const label of ["empty acknowledgement", "missing operation ID", "multiple result entries", "provider accepted then connection lost"]) {
  test(`${label} retains uncertainty and prevents all further traffic`, async t => {
    const root = isolated(t), run = configure(reserve(root)); let count = 0;
    const restore = installVideoRecoveryNetworkGuard(() => run, () => receipt, { fixtureFetch: async () => {
      count++;
      if (label === "provider accepted then connection lost") throw new Error("fixture accepted, local response lost");
      if (label === "empty acknowledgement") return new Response("", { status: 503 });
      if (label === "missing operation ID") return Response.json({ done: false });
      return Response.json({ name: "operations/fixture", done: true, response: { generateVideoResponse: {
        generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/a" } }, {}] } } });
    } }); t.after(restore);
    await assert.rejects(fetch(url, post()), e => e.code === "PROVIDER_ATTEMPT_SUBMISSION_UNCERTAIN");
    await assert.rejects(fetch(url, post()));
    assert.equal(count, 1); assert.equal(run.finish(false), false);
    assert.equal(sharedBudget(root).ledger.runs.at(-1).reservedUsd, .65);
    assert.ok(existsSync(resolve(root, "video-recovery.lock")));
  });
}
test("unacknowledged polls and speech generation have no provider transport", async t => {
  const root = isolated(t), run = configure(reserve(root)); let count = 0;
  const restore = installVideoRecoveryNetworkGuard(() => run, () => receipt, {
    fixtureFetch: async () => { count++; return Response.json({}); } }); t.after(restore);
  await assert.rejects(fetch("https://generativelanguage.googleapis.com/v1beta/operations/guessed"));
  await assert.rejects(fetch("https://api.openai.com/v1/audio/speech", post({ model: "tts-1", input: "denied" })));
  assert.equal(count, 0);
});

test("exact positive approval validates offline; changed price/code/cap/flags/ledger/proof fail closed", () => {
  const manifest = { ...recoveryManifest(),
    pricing: { ...recoveryManifest().pricing, consultedDate: new Date().toISOString().slice(0, 10) } };
  const permission = { approved: true, phase: "pilot", manifestSha256: hash(JSON.stringify(manifest)),
    maximumUsd: .65, ledgerSha256: "snapshot", parentTerminationProofSha256: hash(JSON.stringify(proof())),
    duplicateWorkRiskAccepted: true, parentHoldRetained: true, acceptHistoricalPodcastPass: true, allowChildLockException: true };
  validateRecoveryApproval(permission, "pilot", manifest, "snapshot", proof());
  for (const field of ["approved", "duplicateWorkRiskAccepted", "parentHoldRetained", "acceptHistoricalPodcastPass", "allowChildLockException"]) {
    assert.throws(() => validateRecoveryApproval({ ...permission, [field]: false }, "pilot", manifest, "snapshot", proof()));
  }
  for (const changed of [{ maximumUsd: 6.1 }, { manifestSha256: "old-code" }, { ledgerSha256: "other" },
    { parentTerminationProofSha256: "stale" }, { phase: "completion" }]) {
    assert.throws(() => validateRecoveryApproval({ ...permission, ...changed }, "pilot", manifest, "snapshot", proof()));
  }
  assert.throws(() => validateRecoveryApproval(permission, "pilot",
    { ...manifest, pricing: { ...manifest.pricing, consultedDate: "2000-01-01" } }, "snapshot", proof()), /pricing/);
});
test("live termination evidence needs actual bound files, not missing PID or assertion flags", t => {
  const root = isolated(t);
  assert.throws(() => validateParentTerminationProof({ ...proof(), simulated: false }, root, false), /evidence/);
  const controller = { kind: "observed-launcher-terminal", runId: proof().runId, observedAt: "2026-10-09T00:00:00Z", exitCode: 1 };
  const teardown = { kind: "observed-owned-process-tree-stopped", runId: proof().runId,
    observedAt: "2026-10-09T00:00:00Z", ownedProcessesStopped: true, witness: "launcher-and-owned-process-teardown" };
  const p = { ...proof(), simulated: false };
  for (const [field, value] of [["controllerEvidence", controller], ["teardownEvidence", teardown]]) {
    const bytes = JSON.stringify(value); writeFileSync(resolve(root, field + ".json"), bytes);
    p[field] = { file: field + ".json", sha256: hash(bytes) };
  }
  validateParentTerminationProof(p, root, false);
  writeFileSync(resolve(root, "teardownEvidence.json"), "{}");
  assert.throws(() => validateParentTerminationProof(p, root, false), /changed/);
});
test("unsupported resolution/duration or missing COGS cannot open next clip barrier", t => {
  const run = reserve(isolated(t)); const call = run.submit("clip", body, "event");
  run.capture(call, { providerRequestId: "fixture" }, 600000);
  const playback = { fullDecode: true, width: 1280, height: 720, duration: 6 };
  const accounting = { sourceEventId: "event", costMicrousd: 600000, status: "accounted", creditReservationId: 1 };
  for (const invalid of [{ width: 1920 }, { duration: 6.5 }, { fullDecode: false }]) {
    assert.throws(() => run.acceptClip(call, { ...playback, ...invalid }, accounting), /barrier/);
  }
  assert.throws(() => run.acceptClip(call, playback, { ...accounting, costMicrousd: 0 }), /barrier/);
  assert.throws(() => run.submit("clip", body, "another"), /ordered/);
});
test("partial completion preserves accepted scenes and whole child hold without resume", t => {
  const root = isolated(t), pilot = reserve(root); accept(pilot);
  pilot.writeEvidence("export-before-cleanup.json", { cleanupPermitted: true }); pilot.finish(true);
  const full = reserveVideoRecoveryRun("completion", "partial-full", { root, offline: true, parentProof: proof() });
  const call = full.submit("clip", body, "scene2");
  full.capture(call, { providerRequestId: "scene2-op" }, 600000);
  full.writeBytes("call-1-native.mp4", Buffer.alloc(1100, 2));
  full.acceptClip(call, { fullDecode: true, width: 1280, height: 720, duration: 6 },
    { sourceEventId: "scene2", costMicrousd: 600000, status: "accounted", creditReservationId: 2 });
  full.writeEvidence("export-before-cleanup.json", { cleanupPermitted: true });
  assert.equal(full.finish(false), false);
  assert.equal(sharedBudget(root).ledger.runs.at(-1).reservedUsd, 5.45);
  assert.equal(sharedBudget(root).ledger.runs.at(-1).calls[0].state, "accepted");
  assert.throws(() => reserveVideoRecoveryRun("completion", "replay-denied", { root, offline: true, parentProof: proof() }), /replay/);
});
for (const mutation of ["lock", "parent"]) {
  test(`changed original ${mutation} is rejected without new reservation`, t => {
    const root = isolated(t);
    if (mutation === "lock") writeFileSync(resolve(root, "budget.lock"), "{}");
    else {
      const path = resolve(root, "budget-ledger.json"), ledger = JSON.parse(readFileSync(path));
      ledger.runs.find(run => run.runId === proof().runId).reservedUsd = 0;
      writeFileSync(path, JSON.stringify(ledger));
    }
    assert.throws(() => reserve(root), /parent/);
    assert.ok(!existsSync(resolve(root, "video-recovery.lock")));
  });
}
test("exhausted shared budget rejects completion while preserving parent", t => {
  const root = isolated(t), pilot = reserve(root); accept(pilot);
  pilot.writeEvidence("export-before-cleanup.json", { cleanupPermitted: true }); pilot.finish(true);
  const file = resolve(root, "budget-ledger.json"), ledger = JSON.parse(readFileSync(file));
  ledger.runs.push({ runId: "fixture-other-hold", state: "pending", reservedUsd: 15, calls: [] });
  writeFileSync(file, JSON.stringify(ledger));
  assert.throws(() => reserveVideoRecoveryRun("completion", "funds-denied", { root, offline: true, parentProof: proof() }), /insufficient/);
  assert.ok(!existsSync(resolve(root, "video-recovery.lock")));
});
for (const reason of ["poll-count", "poll-time", "poll-http", "wrong-poll-version", "guessed-download", "oversized-download"]) {
  test(`${reason} stops with acknowledged operation and full held reserve`, async t => {
    const root = isolated(t), run = configure(reserve(root)); let requests = 0;
    const restore = installVideoRecoveryNetworkGuard(() => run, () => receipt, { fixtureFetch: async (input, init) => {
      requests++;
      if (init.method === "POST") return Response.json({ name: "operations/fixture", done: false });
      if (String(input).includes("/files/")) {
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new Uint8Array(65 * 1024 * 1024)); controller.close();
        } }));
      }
      if (reason === "poll-http") return new Response('{"name":"operations/fixture"}', { status: 503 });
      if (reason === "oversized-download") return Response.json({ name: "operations/fixture", done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: {
          uri: "https://generativelanguage.googleapis.com/v1beta/files/fixture:download?alt=media" } }] } } });
      return Response.json({ name: "operations/fixture", done: false });
    } }); t.after(restore);
    await fetch(url, post());
    const poll = "https://generativelanguage.googleapis.com/v1beta/operations/fixture";
    if (reason === "poll-count") {
      for (let i = 0; i < 30; i++) await fetch(poll);
      await assert.rejects(fetch(poll)); assert.equal(requests, 31);
    } else if (reason === "poll-time") {
      const now = Date.now, original = now();
      Date.now = () => original + 300001;
      try { await assert.rejects(fetch(poll)); } finally { Date.now = now; }
      assert.equal(requests, 1);
    } else if (reason === "wrong-poll-version") {
      await assert.rejects(fetch(poll.replace("/v1beta/", "/v1/"))); assert.equal(requests, 1);
    } else if (reason === "guessed-download") {
      await assert.rejects(fetch("https://generativelanguage.googleapis.com/v1beta/files/guessed:download")); assert.equal(requests, 1);
    } else if (reason === "oversized-download") {
      await fetch(poll);
      await assert.rejects(fetch("https://generativelanguage.googleapis.com/v1beta/files/fixture:download?alt=media"));
      assert.equal(requests, 3);
    } else { await assert.rejects(fetch(poll)); assert.equal(requests, 2); }
    assert.equal(run.finish(false), false);
    assert.ok(existsSync(resolve(root, "video-recovery.lock")));
  });
}
for (const kind of ["script", "speech"]) {
  test(`valid default ${kind} request is independently denied by recovery policy`, async t => {
    const run = configure(reserve(isolated(t))); let requests = 0;
    const r = { ...receipt, operationType: kind === "script" ? "video_script" : "video_tts",
      model: kind === "script" ? "gemini-3.5-flash" : "tts-1" };
    const restore = installVideoRecoveryNetworkGuard(() => run, () => r,
      { fixtureFetch: async () => { requests++; return Response.json({}); } }); t.after(restore);
    const endpoint = kind === "script"
      ? "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"
      : "https://api.openai.com/v1/audio/speech";
    const payload = kind === "script" ? {
      contents: [{ role: "user", parts: [{ text: "No new script permitted" }] }],
      generationConfig: { maxOutputTokens: 8192, responseMimeType: "application/json" },
    } : { model: "tts-1", input: "No new speech permitted", voice: "alloy" };
    await assert.rejects(fetch(endpoint, post(payload)), /uncertain|unavailable/);
    assert.equal(requests, 0); assert.equal(run.entry.calls.length, 0);
  });
}
