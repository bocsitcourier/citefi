import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EVIDENCE_ROOT } from "../QA/support/selected-media-plan.mjs";
import { recoveryPreflight, recoveryManifest, assertRecoveryPermission,
  RECOVERY_LIMITS } from "../QA/support/video-recovery-plan.mjs";
import { assertPaidQaLedgerResolved } from "../QA/support/budget-ledger-dispute.mjs";

const [mode = "preflight", phase, runId] = process.argv.slice(2);
const report = mode === "offline"
  ? { manifest: recoveryManifest(), paidExecutionAuthorized: false,
    note: "Offline synthetic fixture only; no historical shared-ledger balance is read or inferred" }
  : recoveryPreflight();
if (mode === "preflight") {
  console.log(JSON.stringify(report, null, 2));
} else {
  if (!["offline", "run"].includes(mode) || !["pilot", "completion", "both"].includes(phase) ||
      !/^[a-z0-9-]{1,64}$/.test(runId ?? "") || mode === "run" && phase === "both") {
    throw new Error("Usage: qa-video-recovery.mjs preflight | offline pilot|completion|both <id> | run pilot|completion <id>");
  }
  if (mode === "run") {
    assertPaidQaLedgerResolved();
    const proof = JSON.parse(readFileSync(resolve(EVIDENCE_ROOT, "video-recovery-parent-termination.json")));
    assertRecoveryPermission(phase, EVIDENCE_ROOT, report.manifest, proof);
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "fixture-no-network") {
      throw new Error("Live recovery requires runtime-injected Gemini credentials");
    }
  } else {
    for (const stage of ["pilot", "completion"]) {
      if (existsSync(resolve("QA/evidence/selected-media-offline", `${runId}-${stage}`))) {
        throw new Error("Offline recovery archive exists; no replay/overwrite across runs");
      }
    }
  }
  console.log(JSON.stringify(report, null, 2));
  const child = spawn(process.execPath, ["--import", "tsx/esm", "--test",
    "--test-name-pattern=video recovery", "tests/qa/media-route-worker-fullchain.test.ts"], {
    detached: true, stdio: "inherit", env: { ...process.env,
      SELECTED_MEDIA_QA: "video", SELECTED_MEDIA_OFFLINE: mode === "offline" ? "1" : "0",
      VIDEO_RECOVERY_QA: phase, SELECTED_MEDIA_RUN_ID: runId, LIVE_QA_IMAGE: "0",
      VIDEO_RECOVERY_STARTED_AT: String(Date.now()) },
  });
  const duration = phase === "both" ? RECOVERY_LIMITS.pilot.deadlineMs + RECOVERY_LIMITS.completion.deadlineMs :
    RECOVERY_LIMITS[phase].deadlineMs;
  let exited = false;
  const timer = setTimeout(() => {
    console.error("Recovery deadline reached; retain all holds, owned DB and artifacts. No automatic resume.");
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    setTimeout(() => { if (!exited) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } }, 2000).unref();
  }, duration);
  timer.unref();
  const [code, signal] = await once(child, "exit");
  exited = true; clearTimeout(timer); process.exitCode = signal ? 1 : Number(code ?? 1);
}
