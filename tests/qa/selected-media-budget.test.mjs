import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { GoogleGenAI } from "@google/genai";
import { EVIDENCE_ROOT, LIMITS, selectedMediaManifest, selectedMediaPreflight,
  assertPaidMediaPermission, hash } from "../../QA/support/selected-media-plan.mjs";
import { reserveSelectedMediaRun } from "../../QA/support/selected-media-run.mjs";
import { validateSelectedSubmission, valueScriptUsage,
  installSelectedMediaNetworkGuard } from "../../QA/support/selected-media-network.mjs";

const receipt = (operationType, model, sourceEventId = "owned-event") =>
  ({ sourceEventId, operationType, model, teamId: 10, attempt: 1 });
const scriptUrl = new URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
const scriptBody = {
  contents: [{ role: "user", parts: [{ text: "Write a bounded script" }] }],
  generationConfig: { maxOutputTokens: 8192, responseMimeType: "application/json" },
};
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
const nativeScript = {
  responseId: "native-script", candidates: [{ finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 2000,
    thoughtsTokenCount: 100, totalTokenCount: 3100 },
};
// The retained live call-3..11 bodies are all zero bytes; their HTTP statuses
// were NOT retained. These statuses are alternatives, not historical claims.
for (const status of [200, 204, 400, 403, 404, 429, 503]) {
test(`empty native acknowledgement HTTP ${status} preserves evidence, hold and no-replay boundary`, async t => {
  const root = isolated(t);
  const run = reserveSelectedMediaRun("video", "empty-ack-test", { root, offline: true });
  let submissions = 0;
  const restore = installSelectedMediaNetworkGuard(
    () => run, () => receipt("veo_clip", LIMITS.videoModel),
    { fixtureFetch: async () => {
      submissions++;
      return new Response(status === 204 ? null : "", { status,
        headers: { "retry-after": "30", "set-cookie": "fixture-only-not-for-export" } });
    } },
  );
  t.after(restore);
  const url = "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning";
  const body = { instances: [{ prompt: "Owned empty acknowledgement scene" }],
    parameters: { durationSeconds: 6, resolution: "720p", sampleCount: 1, aspectRatio: "16:9" } };
  assert.throws(() => validateSelectedSubmission("video",
    new URL(url.replace("/v1beta/", "/v1/")), post(body), receipt("veo_clip", LIMITS.videoModel)),
  /Unapproved/);
  await assert.rejects(fetch(url, post(body)), error =>
    error.code === "PROVIDER_ATTEMPT_SUBMISSION_UNCERTAIN" && error.retryable === false &&
    error.message.includes(`HTTP ${status}; empty JSON body`));
  const http = JSON.parse(readFileSync(resolve(run.directory, "call-1-http.json")));
  assert.equal(http.status, status);
  assert.equal(http.headers["retry-after"], "30");
  assert.equal(http.headers["set-cookie"], undefined);
  assert.equal(readFileSync(resolve(run.directory, "call-1-native.json")).length, 0);
  await assert.rejects(fetch(url, post(body)), /stopped/);
  assert.equal(submissions, 1);
  assert.equal(run.entry.calls[0].state, "pending");
  assert.equal(run.finish(false), false);
  assert.equal(existsSync(resolve(root, "budget.lock")), true);
});
}
function isolated(t) {
  const root = mkdtempSync(resolve(tmpdir(), "selected-budget-unit-"));
  const baseline = resolve(root, "budget-baseline.json");
  cpSync(resolve(EVIDENCE_ROOT, "budget-baseline.json"), baseline);
  writeFileSync(resolve(root, "budget-ledger.json"), JSON.stringify({
    version: 2, ceilingUsd: 30,
    budgetBaseline: { sourceSha256: hash(readFileSync(baseline)) }, runs: [],
  }, null, 2));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

test("Veo SDK serializes the bounded REST body and can read the guard's cloned acknowledgement", async t => {
  const root = isolated(t);
  const run = reserveSelectedMediaRun("video", "sdk-clone-test", { root, offline: true });
  const name = "models/veo-3.1-fast-generate-preview/operations/fixture-ack";
  const native = JSON.stringify({ name });
  let submissions = 0;
  const restore = installSelectedMediaNetworkGuard(
    () => run, () => receipt("veo_clip", LIMITS.videoModel),
    { fixtureFetch: async (input, init) => {
      submissions++;
      const url = new URL(String(input));
      assert.equal(url.pathname, "/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), {
        instances: [{ prompt: "Owned SDK scene" }],
        parameters: { aspectRatio: "16:9", durationSeconds: 6, sampleCount: 1, resolution: "720p" },
      });
      // No request-ID or content-type dependency for a Veo acknowledgement.
      return new Response(native);
    } },
  );
  t.after(restore);
  const ai = new GoogleGenAI({ apiKey: "isolated-fixture-not-a-secret",
    httpOptions: { apiVersion: "v1beta" } });
  const operation = await ai.models.generateVideos({
    model: LIMITS.videoModel, prompt: "Owned SDK scene",
    config: { aspectRatio: "16:9", durationSeconds: 6, numberOfVideos: 1, resolution: "720p" },
  });
  assert.equal(operation.name, name);
  assert.equal(submissions, 1);
  assert.equal(readFileSync(resolve(run.directory, "call-1-native.json"), "utf8"), native);
  assert.equal(JSON.parse(readFileSync(resolve(run.directory, "call-1-operation.json"))).operationName, name);
  assert.equal(run.isStopped(), false);
});

test("offline preflight cannot authorize paid calls or mutate shared budget", () => {
  const before = readFileSync(resolve(EVIDENCE_ROOT, "budget-ledger.json"));
  assert.equal(selectedMediaManifest().scope.includes("production default unchanged"), true);
  assert.throws(() => selectedMediaPreflight(), /ledger dispute unresolved/);
  assert.throws(() => assertPaidMediaPermission("podcast"), /ledger dispute unresolved/);
  assert.throws(() => reserveSelectedMediaRun("podcast", "offline-bad", { offline: true }), /canonical synthetic ledger root/);
  assert.deepEqual(readFileSync(resolve(EVIDENCE_ROOT, "budget-ledger.json")), before);
});

test("script cap covers input plus candidate and thinking tokens, rejects truncation", () => {
  assert.equal(valueScriptUsage(nativeScript).costMicrousd, 20400);
  assert.throws(() => valueScriptUsage({ ...nativeScript, candidates: [{ finishReason: "MAX_TOKENS" }] }), /truncated/);
  assert.throws(() => valueScriptUsage({ ...nativeScript, usageMetadata: {
    ...nativeScript.usageMetadata, totalTokenCount: 3200,
  } }), /inconsistent/);
  assert.throws(() => valueScriptUsage({ ...nativeScript, usageMetadata: {
    promptTokenCount: LIMITS.scriptInputTokens + 1, candidatesTokenCount: 1,
    totalTokenCount: LIMITS.scriptInputTokens + 2,
  } }), /usage/);
});

test("default TTS, tools, oversized speech, auxiliary calls and high-resolution video are blocked", () => {
  const ctx = receipt("podcast_script", LIMITS.scriptModel);
  assert.equal(validateSelectedSubmission("podcast", scriptUrl, post(scriptBody), ctx).kind, "script");
  assert.throws(() => validateSelectedSubmission("podcast", scriptUrl,
    post({ ...scriptBody, generationConfig: { ...scriptBody.generationConfig, candidateCount: 2 } }), ctx));
  for (const extra of [{ tools: [] }, { cachedContent: "cache" }, { systemInstruction: {} }]) {
    assert.throws(() => validateSelectedSubmission("podcast", scriptUrl, post({ ...scriptBody, ...extra }), ctx));
  }
  assert.throws(() => validateSelectedSubmission("podcast", scriptUrl, post(scriptBody),
    receipt("judge", LIMITS.scriptModel)));
  const speechUrl = new URL("https://api.openai.com/v1/audio/speech");
  const tts = { model: "tts-1", input: "A bounded speech input.", voice: "nova" };
  const speechCtx = receipt("podcast_tts", "tts-1");
  assert.equal(validateSelectedSubmission("podcast", speechUrl, post(tts), speechCtx).kind, "tts");
  assert.throws(() => validateSelectedSubmission("podcast", speechUrl, post({ ...tts, model: "gpt-4o-mini-tts" }), speechCtx));
  assert.throws(() => validateSelectedSubmission("podcast", speechUrl, post({ ...tts, input: "x".repeat(4097) }), speechCtx));
  const video = { instances: [{ prompt: "A peaceful coastal landscape." }],
    parameters: { aspectRatio: "16:9", durationSeconds: 6, resolution: "720p", sampleCount: 1 } };
  const videoUrl = new URL("https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning");
  assert.equal(validateSelectedSubmission("video", videoUrl, post(video),
    receipt("veo_clip", LIMITS.videoModel)).kind, "clip");
  assert.throws(() => validateSelectedSubmission("video", videoUrl,
    post({ ...video, parameters: { ...video.parameters, resolution: "1080p" } }),
    receipt("veo_clip", LIMITS.videoModel)));
});

test("isolated ledger prohibits duplicate physical submissions and retains ambiguous holds", t => {
  const root = isolated(t);
  const run = reserveSelectedMediaRun("podcast", "ambiguous-test", { root, offline: true });
  run.submit("script", { model: LIMITS.scriptModel, contents: "owned prompt" }, "owned-1");
  assert.throws(() => run.submit("script", { model: LIMITS.scriptModel, contents: "owned prompt" }, "owned-2"), /retry/);
  assert.equal(run.finish(false), false);
  assert.equal(existsSync(resolve(root, "budget.lock")), true);
  assert.equal(run.entry.state, "pending");
});

test("exact character pricing settles only the matching isolated lock", t => {
  const root = isolated(t);
  const run = reserveSelectedMediaRun("podcast", "settled-test", { root, offline: true });
  const call = run.submit("tts", { model: "tts-1", input: "x".repeat(4096) }, "owned-tts");
  run.capture(call, { providerRequestId: "tts-native" }, 4096 * 15);
  assert.equal(run.finish(false), true);
  assert.equal(run.entry.actualUsd, 0.06144);
  assert.equal(existsSync(resolve(root, "budget.lock")), false);
  assert.equal(call.physicalSubmissions, 0);
});

test("guard preserves operation ID before polling, counts polls and permits only native URI", async t => {
  const root = isolated(t);
  const run = reserveSelectedMediaRun("video", "operations-test", { root, offline: true });
  const name = "models/veo-3.1-fast-generate-preview/operations/owned-op";
  const uri = "https://generativelanguage.googleapis.com/v1beta/files/owned-video:download?alt=media";
  const restore = installSelectedMediaNetworkGuard(() => run, () => receipt("veo_clip", LIMITS.videoModel), {
    fixtureFetch: async (input, init) => {
      if (init.method === "POST") return Response.json({ name });
      if (String(input).includes("/operations/")) {
        assert.equal(existsSync(resolve(run.directory, "call-1-operation.json")), true);
        return Response.json({ name, done: true, response: {
          generateVideoResponse: { generatedSamples: [{ video: { uri } }] },
        } });
      }
      return new Response(Buffer.alloc(1001), { headers: { "content-type": "video/mp4" } });
    },
  });
  t.after(restore);
  await fetch("https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning",
    post({ instances: [{ prompt: "An owned coastal scene" }], parameters: {
      durationSeconds: 6, resolution: "720p", sampleCount: 1, aspectRatio: "16:9",
    } }));
  await fetch(`https://generativelanguage.googleapis.com/v1/${name}`);
  assert.equal(run.entry.calls[0].providerRequestId, name);
  assert.equal(run.entry.calls[0].costMicrousd, 600000);
  await fetch(uri);
  await assert.rejects(fetch(uri), /repeated/);
  assert.equal(run.isStopped(), true);
});

test("stage character and clip caps prevent extra submissions", t => {
  const root = isolated(t);
  const run = reserveSelectedMediaRun("podcast", "characters-test", { root, offline: true });
  for (let i = 0; i < 7; i++) {
    run.submit("tts", { model: "tts-1", input: `${i}${"x".repeat(4095)}` }, `owned-tts-${i}`);
  }
  assert.throws(() => run.submit("tts", { model: "tts-1", input: "x".repeat(4096) }, "owned-tts-extra"), /character cap/);
  assert.equal(run.entry.calls.length, 7);
  const root2 = isolated(t);
  const video = reserveSelectedMediaRun("video", "clips-test", { root: root2, offline: true });
  for (let i = 0; i < 10; i++) video.submit("clip", { model: LIMITS.videoModel, prompt: `scene ${i}` }, `clip-${i}`);
  assert.throws(() => video.submit("clip", { model: LIMITS.videoModel, prompt: "scene 11" }, "clip-11"), /cap/);
  assert.equal(video.entry.calls.length, 10);
});

test("missing native speech ID retains the entire reservation and prevents retries", async t => {
  const root = isolated(t);
  const run = reserveSelectedMediaRun("podcast", "missing-id-test", { root, offline: true });
  let simulated = 0;
  const restore = installSelectedMediaNetworkGuard(() => run, () => receipt("podcast_tts", "tts-1"), {
    fixtureFetch: async () => { simulated++; return new Response(Buffer.alloc(1001)); },
  });
  t.after(restore);
  const url = "https://api.openai.com/v1/audio/speech";
  await assert.rejects(fetch(url, post({ model: "tts-1", voice: "nova", input: "A bounded speech input." })), /unusable/);
  await assert.rejects(fetch(url, post({ model: "tts-1", voice: "nova", input: "Another speech input." })), /stopped/);
  assert.equal(simulated, 1);
  assert.equal(run.finish(false), false);
  assert.equal(existsSync(resolve(root, "budget.lock")), true);
  assert.equal(existsSync(resolve(run.directory, "call-1-native.mp3")), true);
});

test("poll count stops without inventing completion cost", async t => {
  const root = isolated(t);
  const run = reserveSelectedMediaRun("video", "poll-cap-test", { root, offline: true });
  const name = "models/veo-3.1-fast-generate-preview/operations/pending";
  let polls = 0;
  const restore = installSelectedMediaNetworkGuard(() => run, () => receipt("veo_clip", LIMITS.videoModel), {
    fixtureFetch: async (_input, init) => {
      if (init.method !== "POST") polls++;
      return Response.json({ name, done: false });
    },
  });
  t.after(restore);
  await fetch("https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning",
    post({ instances: [{ prompt: "Owned pending coastal scene" }], parameters: {
      durationSeconds: 6, resolution: "720p", sampleCount: 1, aspectRatio: "16:9",
    } }));
  const poll = `https://generativelanguage.googleapis.com/v1/${name}`;
  for (let i = 0; i < 30; i++) await fetch(poll);
  await assert.rejects(fetch(poll), /count\/time cap/);
  assert.equal(polls, 30);
  assert.equal(run.entry.calls[0].state, "pending");
  assert.equal(run.finish(false), false);
  assert.equal(existsSync(resolve(root, "budget.lock")), true);
});

test("elapsed poll deadline prevents another native poll", async t => {
  const root = isolated(t);
  const run = reserveSelectedMediaRun("video", "elapsed-test", { root, offline: true });
  const name = "models/veo-3.1-fast-generate-preview/operations/elapsed";
  let clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  let polls = 0;
  const restore = installSelectedMediaNetworkGuard(() => run, () => receipt("veo_clip", LIMITS.videoModel), {
    fixtureFetch: async (_input, init) => {
      if (init.method !== "POST") polls++;
      return Response.json({ name, done: false });
    },
  });
  t.after(restore);
  await fetch("https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning",
    post({ instances: [{ prompt: "Owned elapsed scene" }], parameters: {
      durationSeconds: 6, resolution: "720p", sampleCount: 1, aspectRatio: "16:9",
    } }));
  clock += 300000;
  await assert.rejects(fetch(`https://generativelanguage.googleapis.com/v1/${name}`), /count\/time cap/);
  assert.equal(polls, 0);
  assert.equal(run.entry.calls[0].state, "pending");
});

test("synthetic approvals and environment flags cannot bypass the disputed live ledger", t => {
  const root = isolated(t);
  const manifestSha256 = hash(JSON.stringify(selectedMediaManifest()));
  const approval = { approved: true, manifestSha256, maximumCombinedUsd: 6.95,
    stages: ["podcast", "video"], newImageCallsAuthorized: false };
  for (const file of ["selected-media-paid-authorization.json", "selected-media-execution-decision.json"]) {
    writeFileSync(resolve(root, file), JSON.stringify(approval));
  }
  const ledgerBefore = readFileSync(resolve(root, "budget-ledger.json"));
  const previous = process.env.QA_LEDGER_DISPUTE_BYPASS;
  process.env.QA_LEDGER_DISPUTE_BYPASS = "1";
  try {
    assert.throws(() => assertPaidMediaPermission("video", root), /ledger dispute unresolved/);
    assert.throws(() => reserveSelectedMediaRun("video", "disputed-live-attempt", { root }), /ledger dispute unresolved/);
  } finally {
    if (previous === undefined) delete process.env.QA_LEDGER_DISPUTE_BYPASS;
    else process.env.QA_LEDGER_DISPUTE_BYPASS = previous;
  }
  assert.deepEqual(readFileSync(resolve(root, "budget-ledger.json")), ledgerBefore);
  assert.equal(existsSync(resolve(root, "budget.lock")), false);
});
