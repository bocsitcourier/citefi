import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { EVIDENCE_ROOT, hash, sharedBudget, selectedMediaManifest } from "./selected-media-plan.mjs";
import { assertPaidQaLedgerResolved } from "./budget-ledger-dispute.mjs";

export const RECOVERY_LIMITS = Object.freeze({
  pilot: { scenes: [1], reserveMicrousd: 650000, deadlineMs: 720000 },
  completion: { scenes: [2, 3, 4, 5, 6, 7, 8, 9, 10], reserveMicrousd: 5450000, deadlineMs: 4200000 },
  postTimeoutMs: 60000, downloadTimeoutMs: 60000, pollTimeoutMs: 30000,
  pollElapsedMs: 300000, pollsPerClip: 30, assetBytes: 64 * 1024 * 1024,
});
export const RECOVERY_SOURCE = resolve(EVIDENCE_ROOT, "video-recovery-source-inventory.json");
const json = path => JSON.parse(readFileSync(path, "utf8"));

export function loadRecoverySources() {
  const inventory = json(RECOVERY_SOURCE);
  const base = resolve(inventory.baseDirectory);
  if (!base.startsWith(EVIDENCE_ROOT + sep)) throw new Error("Recovery source escaped retained evidence");
  for (const key of ["script", "speech"]) {
    const item = inventory[key];
    if (hash(readFileSync(resolve(base, item.nativeFile))) !== item.nativeSha256 ||
        hash(readFileSync(resolve(base, item.receiptFile))) !== item.receiptSha256 ||
        json(resolve(base, item.receiptFile)).sourceEventId !== item.sourceEventId) {
      throw new Error("Retained native source/receipt hash changed");
    }
  }
  for (const [file, expected] of Object.entries(inventory.originalExports)) {
    if (typeof expected === "string" && hash(readFileSync(resolve(base, file))) !== expected) {
      throw new Error("Retained owned export changed");
    }
  }
  const native = json(resolve(base, inventory.script.nativeFile));
  const script = JSON.parse(native.candidates[0].content.parts.filter(p => p.text && !p.thought)
    .map(p => p.text).join(""));
  if (hash(JSON.stringify(script)) !== inventory.script.canonicalSha256 ||
      script.clips.length !== 10 || script.clips.some((c, i) => c.sceneNumber !== i + 1 || c.targetDuration !== 6)) {
    throw new Error("Canonical recovery script changed");
  }
  const exported = json(resolve(base, "owned-db-export.json"));
  for (const key of ["script", "speech"]) {
    const item = inventory[key];
    const usage = exported.providerUsageLedger.filter(r => r.sourceEventId === item.sourceEventId);
    if (usage.length !== 1 || Number(usage[0].costMicrousd) !== item.costMicrousd) {
      throw new Error("Inherited usage evidence inconsistent");
    }
  }
  for (const clip of inventory.oldPhysicalClips) {
    const bytes = readFileSync(resolve(base, `call-${clip.call}-native.json`));
    const request = json(resolve(base, `call-${clip.call}-request.json`));
    if (bytes.length !== 0 || hash(bytes) !== inventory.oldClipAcknowledgementQualification.nativeBodySha256 ||
        request.sourceEventId !== clip.sourceEventId || request.requestSha256 !== clip.requestFingerprintSha256 ||
        hash(readFileSync(resolve(base, `call-${clip.call}-request.json`))) !== clip.requestMetadataFileSha256 ||
        hash(script.clips.find(c => c.sceneNumber === clip.scene).prompt) !== clip.retainedScriptScenePromptSha256) {
      throw new Error("Old uncertain attempt inventory changed");
    }
  }
  const pricing = inventory.pricingSource;
  if (hash(readFileSync(resolve(pricing.file))) !== pricing.sha256) throw new Error("Recovery pricing source changed");
  return { inventory, base, script, audioPath: resolve(base, inventory.speech.nativeFile),
    inventorySha256: hash(readFileSync(RECOVERY_SOURCE)) };
}

export function recoveryManifest() {
  const source = loadRecoverySources();
  const currentPricingFile = resolve(EVIDENCE_ROOT, "video-recovery-pricing-current.md");
  const currentPricingBytes = readFileSync(currentPricingFile);
  const currentPricing = currentPricingBytes.toString("utf8");
  const consultedDate = currentPricing.match(/Consulted (\d{4}-\d{2}-\d{2}) \(UTC\)/)?.[1];
  if (!consultedDate || !currentPricing.includes("Paid Tier, per second in USD") ||
      !currentPricing.includes("Veo 3.1 Fast video with audio price") ||
      !currentPricing.includes("$0.10 (720p)") ||
      !currentPricing.includes("veo-3.1-fast-generate-preview")) {
    throw new Error("Current authoritative recovery pricing incomplete");
  }
  return {
    version: 1, certification: "NOT CERTIFIED", scope: "selected video recovery only; no default/cloud certification",
    parentRunId: source.inventory.originalRunId, parentHoldUsd: 6.3,
    inventorySha256: source.inventorySha256,
    pricing: { file: "QA/evidence/live-current/video-recovery-pricing-current.md",
      sha256: hash(currentPricingBytes), consultedDate, microusdPerSecond: 100000 },
    limits: RECOVERY_LIMITS, scriptCalls: 0, ttsCalls: 0, imageCalls: 0,
    retries: 0, maxInFlight: 1, microusdPerClip: 600000,
    implementation: {
      ...selectedMediaManifest().implementation,
      ...Object.fromEntries([
        "QA/support/video-recovery-plan.mjs", "QA/support/video-recovery-run.mjs",
        "QA/support/video-recovery-network.mjs", "scripts/qa-video-recovery.mjs",
        "tests/qa/video-recovery-acceptance.ts", "types/video-schema.ts",
      ].map(file => [file, hash(readFileSync(resolve(file)))])),
    },
  };
}

export function assertIsolatedRecoveryRoot(root) {
  const actual = realpathSync(root);
  const retained = realpathSync(EVIDENCE_ROOT);
  if (actual === retained || actual.startsWith(retained + sep) || retained.startsWith(actual + sep)) {
    throw new Error("Offline recovery must use an isolated ledger, never retained live evidence");
  }
}

export function validateRecoveryApproval(permission, phase, manifest, ledgerSha256, parentProof) {
  if (!RECOVERY_LIMITS[phase]) throw new Error("Invalid recovery approval phase");
  if (manifest.pricing.consultedDate !== new Date().toISOString().slice(0, 10)) {
    throw new Error("Refresh official recovery pricing for this UTC date");
  }
  if (permission.approved !== true || permission.phase !== phase ||
      permission.manifestSha256 !== hash(JSON.stringify(manifest)) ||
      permission.maximumUsd !== RECOVERY_LIMITS[phase].reserveMicrousd / 1e6 ||
      permission.ledgerSha256 !== ledgerSha256 ||
      permission.parentTerminationProofSha256 !== hash(JSON.stringify(parentProof)) ||
      permission.duplicateWorkRiskAccepted !== true || permission.parentHoldRetained !== true ||
      permission.acceptHistoricalPodcastPass !== true || permission.allowChildLockException !== true) {
    throw new Error("Missing/stale separately approved recovery permission");
  }
}

export function validateParentTerminationProof(proof, root, offline) {
  if (!proof || proof.runId !== "live-selected-video-20261008" ||
      proof.controllerTerminated !== true || proof.ownedProcessTreeStopped !== true || proof.matchingProcessesAbsent !== true) {
    throw new Error("Witnessed parent termination proof required; stale PID is insufficient");
  }
  if (offline && proof.simulated === true) return;
  if (proof.simulated === true) throw new Error("Live termination proof cannot be simulated");
  if (proof.basis === "owner-accepted-current-absence") {
    // The original launcher log was lost. The owner explicitly accepted a
    // fresh, hashed current-absence check in its place. This is labeled as a
    // substitute, not as witnessed historical shutdown.
    const authorizationPath = resolve(root, "paid-verification-authorization-20261009.json");
    const authorization = json(authorizationPath);
    if (typeof authorization.shutdownWitness !== "string" || !authorization.shutdownWitness.includes("in place of the lost original shutdown log") ||
        proof.authorizationSha256 !== hash(readFileSync(authorizationPath))) {
      throw new Error("Owner acceptance of current-absence substitute not bound");
    }
    const evidence = proof.currentAbsenceEvidence;
    if (!evidence?.file || !/^[a-f0-9]{64}$/.test(evidence.sha256 ?? "")) throw new Error("Current-absence evidence file/hash required");
    const path = realpathSync(resolve(root, evidence.file));
    if (!path.startsWith(realpathSync(root) + sep) || hash(readFileSync(path)) !== evidence.sha256) {
      throw new Error("Current-absence evidence escaped boundary or changed");
    }
    const data = json(path);
    const age = Date.now() - Date.parse(data.observedAt ?? "");
    if (data.runId !== proof.runId || data.kind !== "current-absence-check" || !(age >= 0 && age < 6 * 3600 * 1000) ||
        data.matchingProcessCount !== 0 || data.ownedRootCount !== 0 || data.listeningOwnedPorts !== 0) {
      throw new Error("Current-absence evidence stale or shows leftover owned activity");
    }
    return;
  }
  for (const [field, kind] of [["controllerEvidence", "observed-launcher-terminal"],
    ["teardownEvidence", "observed-owned-process-tree-stopped"]]) {
    const evidence = proof[field];
    if (!evidence?.file || !/^[a-f0-9]{64}$/.test(evidence.sha256 ?? "")) {
      throw new Error("Witnessed termination evidence file/hash required");
    }
    const path = realpathSync(resolve(root, evidence.file));
    if (!path.startsWith(realpathSync(root) + sep) || hash(readFileSync(path)) !== evidence.sha256) {
      throw new Error("Parent termination evidence escaped boundary or changed");
    }
    const data = json(path);
    if (data.runId !== proof.runId || data.kind !== kind || !data.observedAt ||
        (field === "controllerEvidence" ? !Number.isInteger(data.exitCode) :
          data.ownedProcessesStopped !== true || data.witness !== "launcher-and-owned-process-teardown")) {
      throw new Error("Parent termination evidence does not prove witnessed shutdown");
    }
  }
}

export function assertRecoveryPermission(phase, root, manifest, parentProof) {
  assertPaidQaLedgerResolved();
  if (!RECOVERY_LIMITS[phase]?.scenes || resolve(root) !== EVIDENCE_ROOT) throw new Error("Invalid live recovery boundary");
  const date = new Date().toISOString().slice(0, 10);
  if (manifest.pricing.consultedDate !== date) throw new Error("Refresh official recovery pricing for this UTC date");
  const sha = hash(JSON.stringify(manifest));
  validateParentTerminationProof(parentProof, root, false);
  for (const file of ["video-recovery-execution-decision.json", `video-recovery-paid-authorization-${phase}.json`]) {
    const permission = json(resolve(root, file));
    validateRecoveryApproval(permission, phase, manifest, hash(readFileSync(resolve(root, "budget-ledger.json"))), parentProof);
  }
  return sha;
}

export function recoveryPreflight() {
  assertPaidQaLedgerResolved();
  const manifest = recoveryManifest();
  return { manifest, manifestSha256: hash(JSON.stringify(manifest)),
    totalBudget: sharedBudget().totalBudget, paidExecutionAuthorized: false,
    originalHoldReleased: false, proposedAdditionalReserveUsd: 6.1,
    note: "Offline preparation only; separate pilot permission and later completion permission required" };
}
