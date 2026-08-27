import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { ingestTelemetry, replayTelemetrySpool } from "../lib/incident-intelligence/service";
import {
  appendProcessDiagnosticRecord,
  classifyChildTermination,
  createSanitizedOutputForwarder,
  processDiagnosticLog,
  sanitizeProcessDiagnostic,
  sanitizeProcessDiagnosticRecord,
} from "../lib/process-diagnostics";

function captureBootstrapFatal(reason: unknown) {
  processDiagnosticLog("error", "Process bootstrap failed:", reason);
  process.exit(1);
}
process.once("uncaughtException", captureBootstrapFatal);
process.once("unhandledRejection", captureBootstrapFatal);

const mode = process.argv[2];
if (mode !== "--web" && mode !== "--worker") throw new Error("expected --web or --worker");
const processName = process.env.BOOTSTRAP_PROCESS_NAME ??
  (mode === "--web" ? "citefi-web" : "citefi-worker");
const webPort = process.env.PORT ?? "5000";
if (mode === "--web" && (!/^\d+$/.test(webPort) || Number(webPort) < 1 || Number(webPort) > 65535)) {
  throw new Error("invalid web PORT");
}
const spool = process.env.PROCESS_DIAGNOSTIC_SPOOL ?? "/var/lib/citefi/diagnostics/process-exits.jsonl";
await replayTelemetrySpool().catch(() => undefined);

const command = process.execPath;
const args = mode === "--web"
  ? ["node_modules/next/dist/bin/next", "start", "-p", webPort]
  : ["--import", "tsx/esm", "--env-file=.env.local", "server/worker-process.ts"];
const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
let stderr = "";
const stdoutForwarder = createSanitizedOutputForwarder((safeText) => process.stdout.write(safeText));
const stderrForwarder = createSanitizedOutputForwarder((safeText) => {
  process.stderr.write(safeText);
  stderr = (stderr + safeText).slice(-16_384);
});
child.stdout.on("data", (chunk: Buffer) => {
  stdoutForwarder.write(chunk);
});
child.stderr.on("data", (chunk: Buffer) => {
  stderrForwarder.write(chunk);
});
let supervisorSignal: NodeJS.Signals | null = null;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    supervisorSignal = signal;
    child.kill(signal);
  });
}
child.on("error", (error) => {
  stderrForwarder.write(`spawn error: ${sanitizeProcessDiagnostic(error)}\n`);
});
const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
stdoutForwarder.end();
stderrForwarder.end();
const termination = classifyChildTermination({
  supervisorSignal,
  code,
  childSignal: child.signalCode,
});
if (termination.planned) {
  processDiagnosticLog(
    "log",
    termination.reason === "clean_exit"
      ? `${processName} child exited cleanly`
      : `${processName} completed supervisor-requested graceful shutdown`,
  );
  process.exit(termination.exitCode);
}
const buildId = await readFile(".next/BUILD_ID", "utf8").then((v) => v.trim()).catch(() => "missing");
let listener = "not-applicable";
if (mode === "--web") {
  listener = await new Promise((resolve) => {
    const probe = spawn("ss", ["-ltn", `( sport = :${webPort} )`]);
    let out = "";
    const collect = createSanitizedOutputForwarder((safeText) => {
      out = (out + safeText).slice(-8_192);
    });
    probe.stdout.on("data", (v) => collect.write(v));
    probe.stderr.on("data", (v) => collect.write(v));
    probe.once("close", () => {
      collect.end();
      resolve(out.trim() || "no-listener");
    });
  });
}
const diagnostic = sanitizeProcessDiagnosticRecord({
  at: new Date().toISOString(), process: processName, code, signal: child.signalCode,
  buildId, listener, restart: process.env.pm_id, stderr,
});
await appendProcessDiagnosticRecord(spool, diagnostic);
await ingestTelemetry({ severity: "critical", category: "SYSTEM",
  message: `${processName} exited unexpectedly (code=${code}, listener=${listener === "no-listener" ? "absent" : "diagnosed"})`,
  process: processName, release: buildId, metadata: diagnostic }).catch(() => undefined);
process.exit(termination.exitCode);