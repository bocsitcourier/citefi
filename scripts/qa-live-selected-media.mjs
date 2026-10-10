import { spawn } from "node:child_process";
import { once } from "node:events";
import { assertPaidMediaPermission, selectedMediaManifest, selectedMediaPreflight,
  LIMITS } from "../QA/support/selected-media-plan.mjs";
import { assertPaidQaLedgerResolved } from "../QA/support/budget-ledger-dispute.mjs";

const [mode = "preflight", stage, runId] = process.argv.slice(2);
if (mode === "preflight") {
  if (runId) throw new Error("Preflight takes only an optional stage");
  console.log(JSON.stringify(selectedMediaPreflight(stage), null, 2));
} else {
  if (!["run", "offline"].includes(mode) || !["podcast", "video"].includes(stage) ||
      !/^[a-z0-9-]{1,80}$/.test(runId ?? "")) {
    throw new Error("Usage: node scripts/qa-live-selected-media.mjs preflight [podcast|video] | offline|run <stage> <unique-id>");
  }
  if (mode === "run") {
    assertPaidQaLedgerResolved();
    assertPaidMediaPermission(stage);
    // Presence only; credentials are runtime-injected, never read from env files.
    if (!process.env.GEMINI_API_KEY || !process.env.OPENAI_API_KEY ||
        [process.env.GEMINI_API_KEY, process.env.OPENAI_API_KEY].includes("fixture-no-network")) {
      throw new Error("Live media requires runtime-injected provider keys");
    }
  }
  const report = mode === "offline"
    ? { manifest: selectedMediaManifest(), paidExecutionAuthorized: false,
      note: "Offline synthetic fixture only; no historical shared-ledger balance is read or inferred" }
    : selectedMediaPreflight(stage);
  console.log(JSON.stringify(report, null, 2));
  const child = spawn(process.execPath, ["--import", "tsx/esm", "--test",
    "--test-name-pattern=selected bounded media",
    "tests/qa/media-route-worker-fullchain.test.ts"], {
    detached: true,
    env: { ...process.env, SELECTED_MEDIA_QA: stage, SELECTED_MEDIA_RUN_ID: runId,
      SELECTED_MEDIA_OFFLINE: mode === "offline" ? "1" : "0",
      LIVE_QA_IMAGE: "0" }, stdio: "inherit",
  });
  let exited = false;
  const watchdog = setTimeout(() => {
    console.error("Selected media deadline reached; preserving owned DB/spool and any pending shared-budget hold. No retries authorized.");
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    setTimeout(() => {
      if (!exited) {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }
    }, 2000).unref();
  }, stage === "podcast" ? LIMITS.podcastDeadlineMs : LIMITS.videoDeadlineMs);
  watchdog.unref();
  const [code, signal] = await once(child, "exit");
  exited = true;
  clearTimeout(watchdog);
  process.exitCode = signal ? 1 : Number(code ?? 1);
}
