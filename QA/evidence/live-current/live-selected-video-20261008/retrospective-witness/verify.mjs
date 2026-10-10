import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { validateParentTerminationProof } from "../../../../support/video-recovery-plan.mjs";

const directory = dirname(import.meta.filename);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const root = resolve("QA/evidence/live-current");
const proof = JSON.parse(readFileSync(resolve(root, "video-recovery-parent-termination.json")));
for (const field of ["controllerEvidence", "teardownEvidence"]) {
  const evidence = readFileSync(resolve(root, proof[field].file));
  if (hash(evidence) !== proof[field].sha256) throw new Error(`Changed ${field}`);
  for (const source of JSON.parse(evidence).sources) {
    if (hash(readFileSync(resolve(root, source.file))) !== source.sha256) {
      throw new Error(`Changed source ${source.file}`);
    }
  }
}
let validationError;
try { validateParentTerminationProof(proof, root, false); }
catch (error) { validationError = error.message; }
if (!validationError) throw new Error("Incomplete witness must remain rejected");

const ps = spawnSync("ps", ["-eo", "pid=,ppid=,comm=,args="], { encoding: "utf8" });
const matching = (ps.stdout ?? "").split("\n").filter(line => {
  const [pid, , comm] = line.trim().split(/\s+/);
  if (Number(pid) === process.pid) return false;
  if (!["postgres", "postmaster", "pg_ctl", "psql", "redis-server", "node"].includes(comm)) return false;
  return /qa_media_acceptance|media-route-worker-|live-selected-video-20261008/.test(line) ||
    (comm === "redis-server" && /\b16388\b/.test(line)) ||
    (["postgres", "postmaster", "pg_ctl", "psql"].includes(comm) && /\b55488\b/.test(line));
});
const ss = spawnSync("ss", ["-ltnp"], { encoding: "utf8" });
const find = spawnSync("find", ["/tmp", "-maxdepth", "1", "-name", "media-route-worker-*"], { encoding: "utf8" });
const finalCode = readFileSync("tests/qa/media-route-worker-fullchain.test.ts");
writeFileSync(resolve(directory, "post-fixture-fix-fullchain.test.ts.txt"), finalCode, { flag: "wx" });
const report = {
  runId: proof.runId, verifiedAt: new Date().toISOString(), retrospective: true,
  boundEvidenceAndSourceHashesVerified: true,
  liveValidator: { accepted: false, error: validationError },
  postTestCurrentCheck: {
    ps: { command: ["ps", "-eo", "pid=,ppid=,comm=,args="], exitCode: ps.status, matching,
      qualification: "Collector itself excluded; initial check retained the collector as a run-name match." },
    ss: { command: ["ss", "-ltnp"], exitCode: ss.status, error: ss.error?.message ?? null,
      matching: (ss.stdout ?? "").split("\n").filter(line => /:(55488|16388)\b/.test(line)) },
    ownedTempRoots: { command: ["find", "/tmp", "-maxdepth", "1", "-name", "media-route-worker-*"],
      exitCode: find.status, stdout: find.stdout, stderr: find.stderr },
    qualification: "Fresh current evidence only, not a historical shutdown witness. ss remains unavailable.",
  },
  finalCode: { file: "post-fixture-fix-fullchain.test.ts.txt", sha256: hash(finalCode),
    qualification: "Assembly-time snapshot predates a six-second isolated audio-fixture correction; teardown was unchanged." },
  fixtureCorrection: "Idea-video fixture now contains real six-second audio and accounts six seconds; podcast fixture remains sixty seconds. No production teardown change.",
  tests: [
    { command: "node --test tests/qa/video-recovery-budget.test.mjs tests/qa/selected-media-budget.test.mjs",
      exitCode: 0, pass: 50, fail: 0 },
    { command: "LIVE_QA_IMAGE=0 SELECTED_MEDIA_QA= SELECTED_MEDIA_OFFLINE=1 VIDEO_RECOVERY_QA= node --import tsx/esm --test tests/qa/media-route-worker-fullchain.test.ts",
      initial: { exitCode: 1, pass: 3, fail: 2, reason: "Sixty-second audio bytes incorrectly declared as six-second narration" },
      final: { exitCode: 0, pass: 5, fail: 0 } },
    { command: "npx tsc --noEmit", initial: { exitCode: 2, errors: 36,
      reason: "Retained TypeScript source snapshot was initially included in compilation" },
      final: { exitCode: 0 }, resolution: "QA/evidence/** excluded by parent agent in tsconfig.json" },
  ],
};
writeFileSync(resolve(directory, "verification.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log("Evidence/source hashes verified; live proof correctly rejected; fresh current checks retained.");
