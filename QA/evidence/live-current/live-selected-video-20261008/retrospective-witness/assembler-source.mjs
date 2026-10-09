// Offline-only, append-only retrospective collection. Never authorizes execution.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const runId = "live-selected-video-20261008";
const root = resolve("QA/evidence/live-current");
const directory = resolve(root, runId, "retrospective-witness");
const witnessAssembledAt = new Date().toISOString();
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const sources = [];
const gaps = [];
function append(file, bytes) {
  writeFileSync(file, bytes, { flag: "wx" });
  return { file: relative(root, file), sha256: sha256(bytes) };
}
function json(file, value) {
  return append(file, JSON.stringify(value, null, 2) + "\n");
}
function retain(original, name) {
  if (!existsSync(original)) {
    gaps.push(`Source unavailable at assembly: ${original}`);
    return false;
  }
  sources.push({ ...append(resolve(directory, name), readFileSync(original)), original });
  return true;
}
mkdirSync(directory, { recursive: true });
retain("/tmp/live-selected-video-20261008.log", "live-selected-video-20261008.log");
retain(resolve(root, runId, "stop.json"), "stop.json");
retain(resolve(root, runId, "export-before-cleanup.json"), "export-before-cleanup.json");
retain(resolve(root, runId, "outcome.json"), "outcome.json");
retain(resolve(root, "video-recovery-live-pilot-decision.md"), "architect-decision.md");
const currentCode = [];
for (const [original, name] of [
  ["tests/qa/media-route-worker-fullchain.test.ts", "media-route-worker-fullchain.test.ts"],
  ["scripts/qa-live-selected-media.mjs", "qa-live-selected-media.mjs"],
]) {
  retain(original, name);
  currentCode.push({ original, sha256: sha256(readFileSync(original)), historicalVersionVerified: false });
}
const testSource = readFileSync("tests/qa/media-route-worker-fullchain.test.ts", "utf8");
const teardown = testSource.match(/async function stopOwnedInfrastructure[\s\S]*?\n}\n/);
if (!teardown) throw new Error("Cannot locate current stopOwnedInfrastructure");
sources.push(append(resolve(directory, "stopOwnedInfrastructure.txt"), teardown[0]));
sources.push(append(resolve(directory, "assembler-source.mjs"), readFileSync(import.meta.filename)));

// No environment values or unrelated process arguments are retained.
function command(command, args, select = output => output) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 10000 });
  return {
    command: [command, ...args], exitCode: result.status,
    error: result.error?.message ?? null,
    stdout: select(result.stdout ?? ""), stderr: result.stderr ?? "",
  };
}
const at = new Date().toISOString();
const ps = command("ps", ["-eo", "pid=,ppid=,comm=,args="], output => output.split("\n").filter(line => {
  const comm = line.trim().split(/\s+/)[2];
  if (!["postgres", "postmaster", "pg_ctl", "psql", "redis-server", "node"].includes(comm)) return false;
  return /qa_media_acceptance|media-route-worker-|live-selected-video-20261008/.test(line) ||
    (comm === "redis-server" && /\b16388\b/.test(line)) ||
    (["postgres", "postmaster", "pg_ctl", "psql"].includes(comm) && /\b55488\b/.test(line));
}).join("\n"));
const ss = command("ss", ["-ltnp"], output => output.split("\n")
  .filter(line => /:(55488|16388)\b/.test(line)).join("\n"));
const find = command("find", ["/tmp", "-maxdepth", "1", "-name", "media-route-worker-*"]);
const backgroundDirectory = "/tmp/replit-background-tasks";
const backgroundSearch = existsSync(backgroundDirectory)
  ? command("grep", ["-rl", "--", runId, backgroundDirectory])
  : { command: ["grep", "-rl", "--", runId, backgroundDirectory], exitCode: null,
    error: "Background task directory is absent", stdout: "", stderr: "" };
// Only retain matching task records. No unrelated background logs are read.
if (backgroundSearch.exitCode === 0) {
  for (const file of backgroundSearch.stdout.trim().split("\n")) {
    if (file.includes("KRlz7fYo")) retain(file, `KRlz7fYo-${sources.length}.log`);
  }
}
// Sources are inspected manually; this collector never promotes log text to
// historical truth automatically.
const backgroundFiles = existsSync(backgroundDirectory) ? readdirSync(backgroundDirectory) : [];
const currentAbsenceCheck = {
  at, commands: [ps.command, ss.command, find.command],
  results: { ps, ss, ownedTempRoots: find },
  matchingProcessesAbsent: ps.exitCode === 0 && ps.stdout === "" && ss.exitCode === 0 && ss.stdout === "",
  anyMatchingTempRootExists: find.exitCode === 0 ? find.stdout.trim() !== "" : null,
  historicalOwnedTempRootIdentityKnown: false,
};
gaps.push(
  "No retained original launcher/controller terminal receipt establishes task KRlz7fYo exit 1; that exit is reported only in the architect memo.",
  "No retained original log establishes completed test.after/stopOwnedInfrastructure without hook failure.",
  "Original shutdown event times and the exact historical owned temporary root are unknown.",
  "Current code snapshots show intended awaited teardown, not the historical executed code version or successful execution.",
  "export-before-cleanup.json proves an export/cleanup permission at 2026-10-08T23:25:20.306Z, not cleanup completion.",
  "Current absence cannot establish historical shutdown.",
);
if (ss.exitCode !== 0) gaps.push("ss current port check unavailable; matchingProcessesAbsent is conservatively false.");
const inventory = json(resolve(directory, "source-inventory.json"), {
  runId, witnessAssembledAt, originalLogAvailable: existsSync("/tmp/live-selected-video-20261008.log"),
  backgroundDirectoryExists: existsSync(backgroundDirectory), backgroundFiles, backgroundSearch,
  currentCode, currentTeardownFunctionSha256: sha256(teardown[0]),
  codeVersionQualification: "Current assembly-time snapshots only; historical launch script/version not independently established.",
});
sources.push(inventory);
sources.push(json(resolve(directory, "current-absence-check.json"), currentAbsenceCheck));
const qualification = {
  firstPartyEvidenced: [
    "Retained historical stop.json reports Unexpected end of JSON input and noRetry:true.",
    "Retained export-before-cleanup.json reports completed evidence export and cleanupPermitted:true, not completed teardown.",
    "Timestamped current local command results, including unavailable-command errors, are retained.",
    "Current test/launcher source snapshots and function hashes are retained.",
  ],
  reportedNotIndependentlyEvidenced: ["Architect memo reports launcher KRlz7fYo exit 1 and completed teardown."],
  inferred: ["Owned ports 55488/16388 and temporary-root naming convention come from current code, not an original launcher log."],
};
const controllerEvidence = json(resolve(directory, "controller-evidence.json"), {
  kind: "observed-launcher-terminal", runId, observedAt: "unknown", exitCode: 1,
  exitCodeQualification: "Reported in architect memo only; NOT a verified observed launcher terminal result.",
  controllerTerminated: false, originalTerminalReceiptAvailable: false,
  retrospective: true, witnessAssembledAt, sources, qualification, gaps,
});
const teardownEvidence = json(resolve(directory, "teardown-evidence.json"), {
  kind: "observed-owned-process-tree-stopped", runId, observedAt: "unknown",
  ownedProcessesStopped: false, witness: "launcher-and-owned-process-teardown",
  retrospective: true, witnessAssembledAt, currentAbsenceCheck, sources, qualification, gaps,
});
json(resolve(root, "video-recovery-parent-termination.json"), {
  runId, simulated: false, controllerTerminated: false, ownedProcessTreeStopped: false,
  matchingProcessesAbsent: currentAbsenceCheck.matchingProcessesAbsent,
  retrospective: true, witnessAssembledAt, controllerEvidence, teardownEvidence, qualification, gaps,
});
console.log("Retrospective evidence assembled append-only; historical shutdown remains unproven.");
