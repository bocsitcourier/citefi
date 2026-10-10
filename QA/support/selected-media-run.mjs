import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync,
  realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { EVIDENCE_ROOT, hash, selectedMediaManifest, sharedBudget,
  assertPaidMediaPermission } from "./selected-media-plan.mjs";
import { assertPaidQaLedgerResolved } from "./budget-ledger-dispute.mjs";

export function durableWrite(path, bytes, exclusive = false) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = exclusive ? path : `${path}.tmp`;
  const fd = openSync(temporary, exclusive ? "wx" : "w", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  if (!exclusive) renameSync(temporary, path);
  const dir = openSync(dirname(path), "r");
  try { fsyncSync(dir); } finally { closeSync(dir); }
}
const json = (path, data, exclusive = false) => durableWrite(path, `${JSON.stringify(data, null, 2)}\n`, exclusive);

export function reserveSelectedMediaRun(stage, runId, options = {}) {
  const offline = options.offline === true;
  if (!offline) assertPaidQaLedgerResolved();
  const root = resolve(options.root ?? EVIDENCE_ROOT);
  if (offline) {
    const actual = realpathSync(root);
    const retained = realpathSync(EVIDENCE_ROOT);
    if (actual !== root || actual === retained || actual.startsWith(retained + sep) ||
        retained.startsWith(actual + sep)) {
      throw new Error("Offline QA requires a canonical synthetic ledger root isolated from retained evidence");
    }
  }
  if (!offline && root !== EVIDENCE_ROOT) throw new Error("Live QA requires the native owner ledger");
  const manifest = selectedMediaManifest();
  const limits = manifest.stages[stage];
  if (!limits || !/^[a-z0-9-]{1,80}$/.test(runId)) throw new Error("Invalid stage/run ID");
  const manifestSha256 = hash(JSON.stringify(manifest));
  if (!offline) assertPaidMediaPermission(stage, root);
  const lockPath = resolve(root, "budget.lock");
  json(lockPath, { runId, stage, offline, pid: process.pid }, true);
  const { ledger, totalBudget } = sharedBudget(root);
  if (ledger.runs.some(r => r.runId === runId)) throw new Error("Replay prohibited; lock retained");
  if (!offline) {
    const prior = ledger.runs.filter(r => !r.offline && r.manifestSha256 === manifestSha256);
    if (prior.some(r => r.stage === stage)) throw new Error("One paid run per approved stage; retry prohibited");
    for (const previous of prior) {
      const outcome = JSON.parse(readFileSync(resolve(root, previous.runId, "outcome.json"), "utf8"));
      const exported = JSON.parse(readFileSync(resolve(root, previous.runId, "export-before-cleanup.json"), "utf8"));
      if (previous.state !== "settled" || outcome.endToEndPass !== true || !exported.cleanupPermitted) {
        throw new Error("Prior media acceptance/export failed; further paid stages blocked");
      }
    }
  }
  if (totalBudget.availableUsd < limits.reservedUsd) throw new Error("Insufficient shared budget; lock retained");
  const directory = resolve(root, runId);
  const entry = { runId, stage, offline, state: "pending", reservedUsd: limits.reservedUsd,
    manifestSha256, calls: /** @type {Array<Record<string, any>>} */ ([]),
    createdAt: new Date().toISOString() };
  ledger.runs.push(entry);
  const persist = () => {
    json(resolve(root, "budget-ledger.json"), ledger);
    ledger.totalBudget = sharedBudget(root).totalBudget;
    json(resolve(root, "budget-ledger.json"), ledger);
  };
  persist();
  json(resolve(directory, "manifest.json"), manifest, true);
  const writeEvidence = (name, value) => {
    if (!/^[a-z0-9-]+\.json$/.test(name)) throw new Error("Invalid evidence filename");
    json(resolve(directory, name), value);
  };
  let scriptCalls = 0, ttsCalls = 0, characters = 0, videoCalls = 0, stopped = false;
  const submit = (kind, request, sourceEventId) => {
    if (stopped) throw new Error("Media run stopped; no further physical calls");
    const requestSha256 = hash(JSON.stringify(request));
    if (entry.calls.some(c => c.requestSha256 === requestSha256)) throw new Error("Physical retry prohibited");
    if (!sourceEventId || entry.calls.some(c => c.sourceEventId === sourceEventId)) throw new Error("Distinct prepared receipt required");
    if (kind === "script") {
      if (++scriptCalls > 1) throw new Error("Script call cap reached");
    } else if (kind === "tts") {
      if (++ttsCalls > limits.ttsCalls || (characters += request.input.length) > limits.ttsCharacters) {
        throw new Error("TTS total submission/character cap reached");
      }
    } else if (kind === "clip") {
      if (++videoCalls > limits.videoCalls) throw new Error("Clip call cap reached");
    } else throw new Error("Unapproved auxiliary provider call");
    const call = { number: entry.calls.length + 1, kind, sourceEventId,
      requestSha256, state: "pending", model: request.model,
      submittedAt: new Date().toISOString(),
      requestUnits: kind === "tts" ? request.input.length : kind === "clip" ? 6 : null,
      physicalSubmissions: offline ? 0 : 1, simulatedSubmissions: offline ? 1 : 0 };
    entry.calls.push(call);
    persist();
    writeEvidence(`call-${call.number}-request.json`, call);
    return call;
  };
  const capture = (call, response, costMicrousd) => {
    if (!entry.calls.includes(call) || call.state !== "pending" ||
        !Number.isSafeInteger(costMicrousd) || costMicrousd < 0 ||
        !response.providerRequestId) throw new Error("Unusable native receipt");
    Object.assign(call, response, { costMicrousd, actualUsd: costMicrousd / 1e6,
      state: "receipted", receivedAt: new Date().toISOString() });
    persist();
    writeEvidence(`call-${call.number}-receipt.json`, call);
  };
  return {
    directory, stage, offline, manifest, entry, writeEvidence, submit, capture,
    isStopped: () => stopped,
    remainingMs: () => (stage === "podcast" ? manifest.limits.podcastDeadlineMs : manifest.limits.videoDeadlineMs) -
      (Date.now() - Date.parse(entry.createdAt)),
    writeBytes(name, bytes) {
      if (!/^[a-z0-9-]+\.(mp3|mp4|json)$/.test(name)) throw new Error("Invalid asset name");
      durableWrite(resolve(directory, name), bytes, true);
    },
    stop(reason) { stopped = true; writeEvidence("stop.json", { reason, noRetry: true }); },
    finish(endToEndPass, evidence = {}) {
      stopped = true;
      writeEvidence("outcome.json", { endToEndPass, evidence, offline,
        certification: "NOT CERTIFIED", applicationRebilling: false });
      // Native valuation and application acceptance are separate. An unknown
      // accepted operation deliberately retains its whole stage reservation.
      if (entry.calls.some(c => c.state !== "receipted") || !entry.calls.length) return false;
      const actualMicrousd = entry.calls.reduce((sum, c) => sum + c.costMicrousd, 0);
      if (actualMicrousd > limits.reservedUsd * 1e6) throw new Error("Reservation overrun; lock retained");
      entry.state = "settled";
      entry.actualUsd = actualMicrousd / 1e6;
      persist();
      writeEvidence("budget-settlement.json", { runId, actualUsd: entry.actualUsd, totalBudget: ledger.totalBudget });
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      if (lock.runId !== runId || lock.stage !== stage) throw new Error("Lock owner changed");
      unlinkSync(lockPath);
      return true;
    },
  };
}
