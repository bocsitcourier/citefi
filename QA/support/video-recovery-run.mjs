import { existsSync, readFileSync, unlinkSync, openSync, closeSync, fsyncSync } from "node:fs";
import { resolve } from "node:path";
import { EVIDENCE_ROOT, hash, sharedBudget } from "./selected-media-plan.mjs";
import { durableWrite } from "./selected-media-run.mjs";
import { RECOVERY_LIMITS, loadRecoverySources, recoveryManifest,
  assertIsolatedRecoveryRoot, assertRecoveryPermission, validateParentTerminationProof } from "./video-recovery-plan.mjs";
import { assertPaidQaLedgerResolved } from "./budget-ledger-dispute.mjs";

const read = file => JSON.parse(readFileSync(file, "utf8"));
const write = (file, value, exclusive = false) => durableWrite(file, `${JSON.stringify(value, null, 2)}\n`, exclusive);
const fail = message => { throw new Error(message); };

export function reserveVideoRecoveryRun(phase, runId, options) {
  const offline = options.offline === true;
  if (!offline) assertPaidQaLedgerResolved();
  const root = resolve(options.root);
  const limits = RECOVERY_LIMITS[phase];
  if (!limits?.scenes || !/^[a-z0-9-]{1,80}$/.test(runId)) fail("Invalid recovery phase/run ID");
  if (offline) assertIsolatedRecoveryRoot(root);
  else if (root !== EVIDENCE_ROOT) fail("Live recovery requires retained shared ledger");
  const sources = loadRecoverySources();
  const manifest = recoveryManifest();
  const manifestSha256 = hash(JSON.stringify(manifest));
  const lockPath = resolve(root, "budget.lock");
  const originalLockBytes = readFileSync(lockPath);
  if (offline) {
    const fixtureLock = JSON.parse(originalLockBytes);
    if (fixtureLock.runId !== manifest.parentRunId || fixtureLock.stage !== "video" ||
        fixtureLock.synthetic !== true) fail("Synthetic parent lock changed");
  } else if (hash(originalLockBytes) !== sources.inventory.originalLockSha256) {
    fail("Original parent lock changed");
  }
  const initialLedgerSha256 = hash(readFileSync(resolve(root, "budget-ledger.json")));
  const { ledger } = sharedBudget(root);
  const parent = ledger.runs.find(r => r.runId === manifest.parentRunId);
  const canonicalParent = sharedBudget(root).ledger.runs.find(r => r.runId === manifest.parentRunId);
  const parentSha256 = hash(JSON.stringify(canonicalParent));
  if (!parent || hash(JSON.stringify(parent)) !== parentSha256 ||
      parent.state !== "pending" || parent.reservedUsd !== 6.3) fail("Original held parent changed");
  if (!offline && phase === "pilot" &&
      hash(readFileSync(resolve(root, "budget-ledger.json"))) !== sources.inventory.originalLedgerSha256) {
    fail("Pilot ledger admission snapshot changed");
  }
  const podcast = ledger.runs.find(r => r.runId === "live-selected-podcast-20261008");
  const podcastDir = resolve(offline ? root : EVIDENCE_ROOT, podcast?.runId ?? "invalid");
  if (!podcast || podcast.state !== "settled" ||
      read(resolve(podcastDir, "outcome.json")).endToEndPass !== true ||
      read(resolve(podcastDir, "export-before-cleanup.json")).cleanupPermitted !== true) fail("Historical podcast acceptance unavailable");
  const proof = options.parentProof;
  validateParentTerminationProof(proof, root, offline);
  if (!offline) assertRecoveryPermission(phase, root, manifest, proof);
  const permissionHashes = offline ? {} : Object.fromEntries(
    ["video-recovery-execution-decision.json", `video-recovery-paid-authorization-${phase}.json`]
      .map(file => [file, hash(readFileSync(resolve(root, file)))]));
  let pilot;
  if (phase === "completion") {
    pilot = ledger.runs.find(r => r.recovery === true && r.phase === "pilot" && r.manifestSha256 === manifestSha256);
    if (!pilot || pilot.state !== "settled" || pilot.offline !== offline) fail("Completion requires accepted settled same-manifest pilot");
    const pilotDirectory = resolve(root, pilot.runId);
    if (read(resolve(pilotDirectory, "outcome.json")).endToEndPass !== true ||
        read(resolve(pilotDirectory, "export-before-cleanup.json")).cleanupPermitted !== true ||
        hash(readFileSync(resolve(pilotDirectory, "call-1-native.mp4"))) !== pilot.calls[0]?.nativeSha256) {
      fail("Pilot acceptance/export/source hash incomplete");
    }
  }
  if (ledger.runs.some(r => r.runId === runId || r.recovery && r.phase === phase)) fail("Recovery phase replay prohibited");
  if (sharedBudget(root).totalBudget.availableUsd * 1e6 < limits.reserveMicrousd) fail("Shared budget insufficient");
  const childLock = resolve(root, "video-recovery.lock");
  const directory = resolve(root, runId);
  write(childLock, { runId, phase, manifestSha256, offline, parentRunId: parent.runId }, true);
  options.fault?.("after-lock");
  let ledgerSha256 = initialLedgerSha256;
  const entry = { runId, stage: "video", recovery: true, phase, offline, state: "pending",
    reservedUsd: limits.reserveMicrousd / 1e6, manifestSha256,
    parentRunId: parent.runId, parentSha256, calls: [], createdAt: new Date().toISOString() };
  const persist = () => {
    if (hash(readFileSync(lockPath)) !== hash(originalLockBytes) ||
        hash(JSON.stringify(read(resolve(root, "budget-ledger.json")).runs.find(r => r.runId === parent.runId))) !== parentSha256 ||
        hash(readFileSync(resolve(root, "budget-ledger.json"))) !== ledgerSha256 ||
        read(childLock).runId !== runId) fail("Recovery ledger/lock ownership diverged; holds retained");
    write(resolve(directory, "reservation-journal.json"), { entry, expectedPreviousLedgerSha256: ledgerSha256 });
    options.fault?.("after-journal");
    ledger.totalBudget = undefined;
    write(resolve(root, "budget-ledger.json"), ledger);
    ledgerSha256 = hash(readFileSync(resolve(root, "budget-ledger.json")));
    options.fault?.("after-ledger");
  };
  ledger.runs.push(entry);
  persist();
  write(resolve(directory, "manifest.json"), manifest, true);
  let stopped = false;
  const started = options.startedAt ?? Date.now();
  const remainingMs = () => limits.deadlineMs - (Date.now() - started);
  const ensureReservation = () => {
    if (stopped || remainingMs() <= 0) fail("Recovery stopped/deadline reached");
    if (hash(readFileSync(resolve(root, "budget-ledger.json"))) !== ledgerSha256 ||
        hash(readFileSync(lockPath)) !== hash(originalLockBytes) || read(childLock).runId !== runId ||
        read(resolve(directory, "reservation-journal.json")).entry.runId !== runId ||
        read(resolve(root, "budget-ledger.json")).runs.find(r => r.runId === runId)?.state !== "pending") {
      fail("Unreserved/divergent recovery POST denied");
    }
  };
  return {
    root, directory, stage: "video", phase, offline, recovery: true, entry, manifest,
    sources, pilot, remainingMs, isStopped: () => stopped,
    writeEvidence: (name, value) => {
      if (!/^[a-z0-9-]+\.json$/.test(name)) fail("Invalid recovery evidence filename");
      write(resolve(directory, name), value);
    },
    writeBytes(name, bytes) {
      if (!/^[a-z0-9-]+\.(mp3|mp4|json)$/.test(name)) fail("Invalid recovery asset filename");
      durableWrite(resolve(directory, name), bytes, true);
    },
    assertLiveAdmission() {
      ensureReservation();
      if (hash(JSON.stringify(recoveryManifest())) !== manifestSha256) fail("Recovery implementation/source changed");
      // Admission approval pins the pre-reservation ledger. After admission,
      // recheck the immutable permission against that snapshot, not our own writes.
      if (!offline) {
        for (const file of ["video-recovery-execution-decision.json", `video-recovery-paid-authorization-${phase}.json`]) {
          const approved = read(resolve(root, file));
          if (hash(readFileSync(resolve(root, file))) !== permissionHashes[file] ||
              approved.approved !== true || approved.manifestSha256 !== manifestSha256 ||
              approved.phase !== phase || approved.maximumUsd !== limits.reserveMicrousd / 1e6 ||
              manifest.pricing.consultedDate !== new Date().toISOString().slice(0, 10)) fail("Recovery permission revoked/stale");
        }
      }
      return manifestSha256;
    },
    submit(kind, body, sourceEventId) {
      ensureReservation();
      const index = entry.calls.length;
      const expectedScene = limits.scenes[index];
      if (kind !== "clip" || !expectedScene || entry.calls.some(c => c.state !== "accepted") ||
          entry.calls.some(c => c.sourceEventId === sourceEventId || c.requestSha256 === hash(JSON.stringify(body)))) {
        fail("Recovery only admits one new ordered clip, no retries or auxiliaries");
      }
      const overhead = phase === "completion" ? 360000 : 180000;
      if (remainingMs() < (limits.scenes.length - index) * 420000 + overhead) fail("Insufficient bounded lifecycle time; no next POST");
      const call = { number: index + 1, kind, scene: expectedScene, sourceEventId,
        requestSha256: hash(JSON.stringify(body)), state: "pending",
        physicalSubmissions: offline ? 0 : 1, simulatedSubmissions: offline ? 1 : 0 };
      entry.calls.push(call); persist();
      write(resolve(directory, `call-${call.number}-request.json`), { ...call, body });
      ensureReservation();
      options.fault?.("before-post");
      return call;
    },
    capture(call, response, costMicrousd) {
      if (!entry.calls.includes(call) || call.state !== "pending" || costMicrousd !== 600000) fail("Unusable recovery cost evidence");
      Object.assign(call, response, { costMicrousd, state: "native_complete" }); persist();
      write(resolve(directory, `call-${call.number}-receipt.json`), call);
    },
    acceptClip(call, playback, accounting) {
      if (call.state !== "native_complete" || !playback.fullDecode ||
          playback.width !== 1280 || playback.height !== 720 || Math.abs(playback.duration - 6) > 0.1 ||
          accounting.sourceEventId !== call.sourceEventId || accounting.costMicrousd !== 600000 ||
          accounting.status !== "accounted" || !accounting.creditReservationId) fail("Clip playback/accounting barrier failed");
      call.nativeSha256 = hash(readFileSync(resolve(directory, `call-${call.number}-native.mp4`)));
      call.state = "accepted"; persist();
      write(resolve(directory, `call-${call.number}-acceptance.json`), { playback, accounting, nativeSha256: call.nativeSha256 });
    },
    stop(reason) { stopped = true; write(resolve(directory, "stop.json"), { reason, noReplay: true, holdRetained: true }); },
    finish(passed, evidence = {}) {
      stopped = true;
      const accepted = passed && entry.calls.length === limits.scenes.length && entry.calls.every(c => c.state === "accepted") &&
        existsSync(resolve(directory, "export-before-cleanup.json")) &&
        read(resolve(directory, "export-before-cleanup.json")).cleanupPermitted === true;
      write(resolve(directory, "outcome.json"), { endToEndPass: accepted, offline, evidence, certification: "NOT CERTIFIED" });
      if (!accepted || entry.calls.length !== limits.scenes.length || entry.calls.some(c => c.state !== "accepted") ||
          !existsSync(resolve(directory, "export-before-cleanup.json")) ||
          read(resolve(directory, "export-before-cleanup.json")).cleanupPermitted !== true) return false;
      entry.state = "settled";
      entry.actualUsd = entry.calls.reduce((sum, c) => sum + c.costMicrousd, 0) / 1e6;
      persist();
      write(resolve(directory, "budget-settlement.json"), { actualUsd: entry.actualUsd, originalHoldReleased: false });
      unlinkSync(childLock);
      const fd = openSync(root, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
      return true;
    },
  };
}
