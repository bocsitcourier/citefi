import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { assertPaidQaLedgerResolved } from "./budget-ledger-dispute.mjs";

export const EVIDENCE_ROOT = resolve("QA/evidence/live-current");
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function assertBudgetRoot(root) {
  const requested = resolve(root);
  const actual = realpathSync(requested);
  const retained = realpathSync(EVIDENCE_ROOT);
  if (actual !== requested || (actual !== retained &&
      (actual.startsWith(retained + sep) || retained.startsWith(actual + sep)))) {
    throw new Error("Budget root must be canonical and isolated from retained owner evidence");
  }
}
export const LIMITS = Object.freeze({
  scriptModel: "gemini-3.5-flash",
  ttsModel: "tts-1",
  videoModel: "veo-3.1-fast-generate-preview",
  scriptBytes: 32768,
  scriptInputTokens: 65536,
  scriptOutputTokens: 8192,
  ttsSegmentCharacters: 4096,
  podcastSegments: 40,
  podcastCharacters: 30000,
  videoClips: 10,
  clipSeconds: 6,
  resolution: "720p",
  pollsPerClip: 30,
  pollElapsedMs: 300000,
  scriptTimeoutMs: 180000,
  ttsTimeoutMs: 120000,
  pollTimeoutMs: 30000,
  assetBytes: 64 * 1024 * 1024,
  podcastDeadlineMs: 600000,
  videoDeadlineMs: 900000,
});

export function sharedBudget(root = EVIDENCE_ROOT) {
  if (resolve(root) === EVIDENCE_ROOT) assertPaidQaLedgerResolved();
  assertBudgetRoot(root);
  const baselineBytes = readFileSync(resolve(root, "budget-baseline.json"));
  const baseline = JSON.parse(baselineBytes);
  const ledger = JSON.parse(readFileSync(resolve(root, "budget-ledger.json")));
  if (baseline.version !== 1 || baseline.ceilingUsd !== 30 ||
      baseline.knownPriorUsd !== 0.517071 || baseline.historicalHoldUsd !== 6 ||
      baseline.historicalCalls !== "UNKNOWN / UNRECONCILED" ||
      ledger.version !== 2 || ledger.ceilingUsd !== 30 ||
      ledger.budgetBaseline?.sourceSha256 !== hash(baselineBytes) ||
      !Array.isArray(ledger.runs)) throw new Error("Unapproved shared USD30 baseline/ledger");
  const committed = ledger.runs.reduce((sum, r) => {
    const usd = r.state === "settled" ? r.actualUsd : r.reservedUsd;
    if (!Number.isFinite(usd) || usd < 0) throw new Error("Invalid ledger amount");
    return sum + Math.round(usd * 1e6);
  }, 0);
  const availableMicrousd = 30e6 - 517071 - 6e6 - committed;
  return { ledger, baseline, totalBudget: {
    ceilingUsd: 30, knownPriorUsd: 0.517071, historicalHoldUsd: 6,
    historicalHoldIsActualSpend: false, historicalCalls: baseline.historicalCalls,
    newCommittedUsd: committed / 1e6, availableUsd: availableMicrousd / 1e6,
  } };
}

export function selectedMediaManifest() {
  const pricing = readFileSync(resolve(EVIDENCE_ROOT, "selected-media-pricing.md"), "utf8");
  const speech = readFileSync(resolve(EVIDENCE_ROOT, "openai-bounded-speech-source.md"), "utf8");
  for (const expected of ["$1.50/M", "$9.00/M", "$0.10/second", "$15.00/M",
    "2026-10-08T21:43:43Z"]) {
    if (!pricing.includes(expected)) throw new Error("Current pricing evidence incomplete");
  }
  if (!speech.includes("$15.00") || !speech.includes("4096")) throw new Error("TTS source incomplete");
  return {
    version: 1,
    scope: "selected-model TTS-1; production default unchanged; filesystem only",
    certification: "NOT CERTIFIED",
    pricing: {
      file: "selected-media-pricing.md", sha256: hash(pricing),
      speechFile: "openai-bounded-speech-source.md", speechSha256: hash(speech),
      fetchedDate: "2026-10-08",
      scriptInputUsdPerMillion: 1.5, scriptOutputUsdPerMillion: 9,
      ttsUsdPerMillionCharacters: 15, videoUsdPerSecond: 0.1,
    },
    limits: LIMITS,
    stages: {
      podcast: { scripts: 1, ttsCalls: 40, ttsCharacters: 30000, videoCalls: 0,
        maximumUsd: 0.622032, reservedUsd: 0.65 },
      video: { scripts: 1, ttsCalls: 1, ttsCharacters: 4096, videoCalls: 10,
        maximumUsd: 6.233472, reservedUsd: 6.3 },
    },
    combinedReserveUsd: 6.95,
    retries: 0,
    prohibited: ["model fallback", "expansion generation", "judges", "grounding",
      "customer DB", "cloud certification", "publishing", "scheduler startup"],
    exportBeforeCleanup: true,
    executionPolicy: "one paid run per stage; stop before next stage after failed acceptance/export; same-UTC-day pricing",
    implementation: Object.fromEntries([
      "QA/support/selected-media-plan.mjs",
      "QA/support/selected-media-run.mjs",
      "QA/support/selected-media-network.mjs",
      "scripts/qa-live-selected-media.mjs",
      "tests/qa/selected-media-acceptance.ts",
      "tests/qa/media-route-worker-fullchain.test.ts",
      "lib/openai-tts.ts", "lib/merge-mp3-segments.ts", "lib/podcast-generator.ts", "lib/podcast-worker.ts",
      "lib/veo-video-generator.ts", "lib/attach-video-narration.ts", "lib/veo-video-tts-generator.ts",
      "lib/veo-social-video-generator.ts", "lib/veo-script-generator.ts",
      "lib/provider-attempt-receipts.ts", "workers/video-idea-worker.ts",
      "app/api/public-objects/[...path]/route.ts",
    ].map(file => [file, hash(readFileSync(resolve(file)))])),
    acceptance: ["native scripts and receipts", "production credit debit and COGS",
      "cross-tenant generation denial without paid submission", "HTTP byte retrieval",
      "cross-tenant retrieval denial", "durable operation IDs before polls",
      "complete FFmpeg decode", "ffprobe duration/resolution", "non-silent audio"],
  };
}

export function assertPaidMediaPermission(stage, root = EVIDENCE_ROOT) {
  assertPaidQaLedgerResolved();
  const manifest = selectedMediaManifest();
  const manifestSha256 = hash(JSON.stringify(manifest));
  if (!["podcast", "video"].includes(stage)) throw new Error("Unknown stage");
  if (new Date().toISOString().slice(0, 10) !== manifest.pricing.fetchedDate) {
    throw new Error("Paid media blocked: refresh authoritative pricing and manifest approvals for this UTC date");
  }
  for (const file of ["selected-media-paid-authorization.json", "selected-media-execution-decision.json"]) {
    const path = resolve(root, file);
    if (!existsSync(path)) throw new Error(`Paid media blocked: missing ${file}`);
    const approval = JSON.parse(readFileSync(path, "utf8"));
    if (approval.approved !== true || approval.manifestSha256 !== manifestSha256 ||
        approval.maximumCombinedUsd !== 6.95 || !approval.stages?.includes(stage) ||
        approval.newImageCallsAuthorized !== false) {
      throw new Error(`Paid media blocked: stale or incompatible ${file}`);
    }
  }
  if (stage === "video") {
    const podcast = sharedBudget(root).ledger.runs.find(run =>
      !run.offline && run.stage === "podcast" && run.manifestSha256 === manifestSha256);
    if (!podcast || podcast.state !== "settled") {
      throw new Error("Paid video requires the approved podcast to settle successfully first");
    }
    const outcome = JSON.parse(readFileSync(resolve(root, podcast.runId, "outcome.json"), "utf8"));
    const exported = JSON.parse(readFileSync(resolve(root, podcast.runId, "export-before-cleanup.json"), "utf8"));
    if (outcome.endToEndPass !== true || exported.cleanupPermitted !== true) {
      throw new Error("Paid video blocked: podcast acceptance/export incomplete or failed");
    }
  }
  return manifestSha256;
}

export function selectedMediaPreflight(stage) {
  assertPaidQaLedgerResolved();
  const manifest = selectedMediaManifest();
  if (stage && !manifest.stages[stage]) throw new Error("Unknown stage");
  const { totalBudget } = sharedBudget();
  if (totalBudget.availableUsd < (stage ? manifest.stages[stage].reservedUsd : 6.95)) {
    throw new Error("Shared USD30 cannot cover the bounded media reservation");
  }
  return {
    manifest, manifestSha256: hash(JSON.stringify(manifest)), totalBudget,
    budgetLocked: existsSync(resolve(EVIDENCE_ROOT, "budget.lock")),
    paidExecutionAuthorized: false,
    note: "Offline preflight does not reserve budget or grant paid execution",
  };
}
