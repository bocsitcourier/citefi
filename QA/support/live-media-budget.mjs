import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

const ROOT = resolve("QA/evidence/live-current");
const BASELINE_FILE = resolve("QA/evidence/live-current/budget-baseline.json");
const LEDGER_FILE = join(ROOT, "budget-ledger.json");
const LOCK_FILE = join(ROOT, "budget.lock");
const PRICING_FILE = join(ROOT, "media-pricing-current.md");
const MODEL = "gemini-3.1-flash-image";
const MAX_REQUEST_BYTES = 8192;
const MAX_INPUT_TOKENS = 16_000;
const MAX_IMAGE_OUTPUT_TOKENS = 2520;
const IMAGE_OUTPUT_USD_PER_MILLION = 60;
const INPUT_USD_PER_MILLION = 0.5;
const RESERVE_USD = 0.16;
const SOURCE_URL = "https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-image";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function durableJson(path, data) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  const fd = openSync(temp, "w", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function readBaseline() {
  const text = readFileSync(BASELINE_FILE, "utf8");
  const baseline = JSON.parse(text);
  if (
    baseline.version !== 1 ||
    baseline.ceilingUsd !== 30 ||
    baseline.knownPriorUsd !== 0.517071 ||
    baseline.historicalHoldUsd !== 6 ||
    baseline.historicalCalls !== "UNKNOWN / UNRECONCILED"
  ) {
    throw new Error("The shared USD30 budget baseline is not the approved baseline");
  }
  return { baseline, sourceSha256: sha256(text) };
}

function totalBudget(baseline, runs) {
  const committedMicrousd = runs.reduce((sum, run) => {
    const amount = run.state === "settled" ? run.actualUsd : run.reservedUsd;
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid shared media ledger amount");
    return sum + Math.ceil(amount * 1_000_000);
  }, 0);
  const ceilingMicrousd = Math.round(baseline.ceilingUsd * 1_000_000);
  const knownPriorMicrousd = Math.round(baseline.knownPriorUsd * 1_000_000);
  const holdMicrousd = Math.round(baseline.historicalHoldUsd * 1_000_000);
  return {
    ceilingUsd: baseline.ceilingUsd,
    knownPriorUsd: baseline.knownPriorUsd,
    historicalHoldUsd: baseline.historicalHoldUsd,
    historicalHoldIsActualSpend: false,
    historicalCalls: baseline.historicalCalls,
    newCommittedUsd: committedMicrousd / 1_000_000,
    availableUsd: (ceilingMicrousd - knownPriorMicrousd - holdMicrousd - committedMicrousd) / 1_000_000,
  };
}

function readLedger(baseline, baselineHash) {
  if (!existsSync(LEDGER_FILE)) {
    return { version: 2, ceilingUsd: 30, budgetBaseline: { ...baseline, sourceSha256: baselineHash }, runs: [] };
  }
  const ledger = JSON.parse(readFileSync(LEDGER_FILE, "utf8"));
  if (
    ledger.version !== 2 ||
    ledger.ceilingUsd !== 30 ||
    ledger.budgetBaseline?.sourceSha256 !== baselineHash ||
    !Array.isArray(ledger.runs)
  ) {
    throw new Error("The shared live budget ledger has an unexpected version or baseline");
  }
  return ledger;
}

function assertPricingEvidence() {
  const source = readFileSync(PRICING_FILE, "utf8");
  const section = (source.split("## Gemini 3.1 Flash Image")[1]?.split("\n## ")[0] ?? "")
    .replace(/\s+/g, " ");
  if (
    source.length < 100 ||
    !section.includes("$0.50 (text/image)") ||
    !section.includes("$60.00 (images)") ||
    !/\b2,?520 tokens\b/.test(section) ||
    !section.includes("$0.151 per image") ||
    !source.includes("Fetched 2026-10-08T20:14:23Z")
  ) {
    throw new Error("Official image pricing evidence is incomplete or does not support the configured cap");
  }
  return { file: "media-pricing-current.md", sha256: sha256(source), url: SOURCE_URL };
}

/**
 * Offline only. This does not read credentials, touch the network, or reserve
 * budget. It verifies the published source and the existing shared ledger.
 */
export function preflight() {
  const { baseline, sourceSha256 } = readBaseline();
  const ledger = readLedger(baseline, sourceSha256);
  const pricing = assertPricingEvidence();
  const maximumUsd =
    (MAX_INPUT_TOKENS * INPUT_USD_PER_MILLION +
      MAX_IMAGE_OUTPUT_TOKENS * IMAGE_OUTPUT_USD_PER_MILLION) / 1_000_000;
  if (maximumUsd > RESERVE_USD) throw new Error("Image reservation does not cover the complete capped operation");
  const budget = totalBudget(baseline, ledger.runs);
  if (budget.availableUsd < RESERVE_USD) throw new Error("Shared USD30 budget cannot cover one image reservation");
  return {
    stage: "image",
    provider: "gemini",
    model: MODEL,
    pricing,
    physicalCallsMaximum: 1,
    requestBytesMaximum: MAX_REQUEST_BYTES,
    inputTokensMaximum: MAX_INPUT_TOKENS,
    imageOutputTokensMaximum: MAX_IMAGE_OUTPUT_TOKENS,
    maximumCogsUsd: maximumUsd,
    reservedUsd: RESERVE_USD,
    noRetry: true,
    inputRateUsdPerMillion: INPUT_USD_PER_MILLION,
    imageOutputRateUsdPerMillion: IMAGE_OUTPUT_USD_PER_MILLION,
    budgetBaseline: { ...baseline, sourceSha256 },
    totalBudget: budget,
    historicalCalls: "UNKNOWN / UNRECONCILED; historical HOLD remains coverage only, not actual spend",
    storageClaim: "This budget helper does not certify cloud object storage; the caller must report its storage boundary explicitly.",
  };
}

/**
 * Reserve the single bounded image stage in the existing shared USD30 ledger.
 * A pending run or stale budget.lock deliberately remains held for human
 * reconciliation; this helper never removes a lock after an ambiguous call.
 */
export function reserveImageRun(runId, report = preflight()) {
  if (!/^[a-z0-9-]{1,80}$/.test(runId)) throw new Error("Invalid media QA run ID");
  const { baseline, sourceSha256 } = readBaseline();
  if (report.budgetBaseline?.sourceSha256 !== sourceSha256) throw new Error("Image preflight baseline changed");
  mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const lockFd = openSync(LOCK_FILE, "wx", 0o600);
  try {
    writeFileSync(lockFd, JSON.stringify({ runId, stage: "image", pid: process.pid }));
    fsyncSync(lockFd);
  } finally {
    closeSync(lockFd);
  }

  let finalized = false;
  try {
    const ledger = readLedger(baseline, sourceSha256);
    if (ledger.runs.some((run) => run.runId === runId)) throw new Error("Run already exists; replay is prohibited");
    if (totalBudget(baseline, ledger.runs).availableUsd < RESERVE_USD) {
      throw new Error("Shared USD30 budget is exhausted after known prior valuation and historical HOLD");
    }
    const directory = join(ROOT, runId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    durableJson(join(directory, "image-preflight.json"), report);
    const entry = {
      runId,
      state: "pending",
      reservedUsd: RESERVE_USD,
      calls: [],
      createdAt: new Date().toISOString(),
    };
    ledger.runs.push(entry);
    const persist = () => {
      ledger.totalBudget = totalBudget(baseline, ledger.runs);
      durableJson(LEDGER_FILE, ledger);
    };
    persist();

    let submitted = false;
    let ambiguous = false;
    const submit = (requestBytes, requestHash) => {
      if (submitted || ambiguous) throw new Error("Image physical retry or repeated submission is prohibited");
      if (!Number.isSafeInteger(requestBytes) || requestBytes <= 0 || requestBytes > MAX_REQUEST_BYTES) {
        throw new Error("Image request exceeded its byte cap");
      }
      submitted = true;
      const attempt = {
        role: "image",
        provider: "gemini",
        model: MODEL,
        requestSha256: requestHash,
        inputBytes: requestBytes,
        physicalCount: 1,
        state: "pending",
        maximumUsd: report.maximumCogsUsd,
        submittedAt: new Date().toISOString(),
      };
      entry.calls.push(attempt);
      persist();
      durableJson(join(directory, "image-request.json"), attempt);
      return attempt;
    };
    const receive = (attempt, response, body) => {
      durableJson(join(directory, "image-native-response.json"), body);
      const usage = body?.usageMetadata;
      const inputTokens = usage?.promptTokenCount;
      const details = usage?.candidatesTokensDetails ?? [];
      const nativeImageTokens = details
        .filter((detail) => detail.modality === "IMAGE")
        .reduce((sum, detail) => sum + (Number.isSafeInteger(detail.tokenCount) ? detail.tokenCount : 0), 0);
      const parts = (body?.candidates ?? []).flatMap((candidate) => candidate.content?.parts ?? []);
      const imageOnly = parts.length === 1 &&
        typeof parts[0]?.inlineData?.data === "string" &&
        /^image\//.test(parts[0]?.inlineData?.mimeType ?? "");
      // IMAGE-only native output without a modality detail block is still
      // priced by its native candidate-token count, not a guessed image size.
      const imageTokens = nativeImageTokens || (imageOnly ? usage?.candidatesTokenCount : null);
      const textOutputTokens = (usage?.candidatesTokenCount ?? 0) - imageTokens;
      const thinkingTokens = usage?.thoughtsTokenCount ?? 0;
      const requestId = body?.responseId ?? response.headers.get("x-request-id");
      const actualModel = body?.modelVersion ?? null;
      const known =
        response.ok &&
        typeof requestId === "string" &&
        (actualModel === MODEL || actualModel?.startsWith(`${MODEL}-`)) &&
        Number.isSafeInteger(inputTokens) &&
        inputTokens >= 0 &&
        inputTokens <= MAX_INPUT_TOKENS &&
        Number.isSafeInteger(imageTokens) &&
        imageTokens > 0 &&
        imageTokens <= MAX_IMAGE_OUTPUT_TOKENS &&
        Number.isSafeInteger(textOutputTokens) &&
        textOutputTokens === 0 &&
        Number.isSafeInteger(thinkingTokens) && thinkingTokens >= 0 &&
        Number.isSafeInteger(usage?.totalTokenCount) &&
        usage.totalTokenCount === inputTokens + imageTokens + thinkingTokens &&
        imageTokens + thinkingTokens <= MAX_IMAGE_OUTPUT_TOKENS &&
        imageOnly;
      const actualUsd = known
        ? (inputTokens * INPUT_USD_PER_MILLION + imageTokens * IMAGE_OUTPUT_USD_PER_MILLION +
          thinkingTokens * 3) / 1_000_000
        : null;
      const receipt = {
        ...attempt,
        status: response.status,
        providerRequestId: requestId ?? null,
        actualModel,
        usage: usage ?? null,
        responseSha256: sha256(JSON.stringify(body)),
        costBasis: "Official standard-tier native token rates: input $0.50/M, image output $60/M, thinking $3/M",
        billedSplit: { inputTokens, imageTokens, thinkingTokens },
        actualUsd,
        state: known && actualUsd <= RESERVE_USD ? "receipted" : "ambiguous",
        receivedAt: new Date().toISOString(),
      };
      durableJson(join(directory, "image-receipt.json"), receipt);
      Object.assign(attempt, receipt);
      persist();
      if (attempt.state !== "receipted") {
        ambiguous = true;
        throw new Error("Image provider outcome or usage is ambiguous; keep the shared reservation and do not retry");
      }
      return receipt;
    };

    return {
      directory,
      hasSubmitted() {
        return submitted;
      },
      abortBeforeSubmission() {
        if (submitted || finalized) throw new Error("Cannot release an image reservation after submission");
        ledger.runs = ledger.runs.filter((run) => run.runId !== runId);
        ledger.totalBudget = totalBudget(baseline, ledger.runs);
        durableJson(LEDGER_FILE, ledger);
        unlinkSync(LOCK_FILE);
        finalized = true;
      },
      writeEvidence(name, value) {
        if (!/^[a-z0-9-]{1,80}\.json$/.test(name)) throw new Error("Invalid image evidence filename");
        durableJson(join(directory, name), value);
      },
      writeAsset(name, bytes) {
        if (!/^[a-z0-9-]{1,80}\.(png|mp3|mp4)$/.test(name) || !Buffer.isBuffer(bytes)) {
          throw new Error("Invalid retained media asset");
        }
        const fd = openSync(join(directory, name), "wx", 0o600);
        try {
          writeFileSync(fd, bytes);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
      submit,
      receive,
      markAmbiguous() {
        ambiguous = true;
      },
      finish({ endToEndPass, evidence = {} }) {
        if (finalized) throw new Error("Image run was already finalized");
        const call = entry.calls[0];
        if (endToEndPass && (!call || call.state !== "receipted")) {
          throw new Error("Cannot pass the image stage without a verified provider usage receipt");
        }
        durableJson(join(directory, "image-outcome.json"), {
          endToEndPass: Boolean(endToEndPass),
          storageClaim: evidence.storageClaim ?? report.storageClaim,
          evidence,
          totalBudget: totalBudget(baseline, ledger.runs),
          providerUsageUsd: call?.state === "receipted" ? call.actualUsd : null,
          physicalCalls: call ? call.physicalCount : 0,
          finishedAt: new Date().toISOString(),
        });
        if (ambiguous || !call || call.state !== "receipted") return;
        entry.state = "settled";
        entry.actualUsd = call.actualUsd;
        persist();
        durableJson(join(directory, "budget-settlement.json"), {
          runId,
          stage: "image",
          state: "settled",
          actualUsd: entry.actualUsd,
          totalBudget: ledger.totalBudget,
          budgetBaseline: { ...baseline, sourceSha256 },
        });
        unlinkSync(LOCK_FILE);
        finalized = true;
      },
    };
  } catch (error) {
    // Only remove the newly created lock when no reservation was committed.
    // Once the shared ledger contains a pending run, human reconciliation owns it.
    const current = existsSync(LEDGER_FILE) ? JSON.parse(readFileSync(LEDGER_FILE, "utf8")) : null;
    if (!current?.runs?.some((run) => run.runId === runId)) {
      try { unlinkSync(LOCK_FILE); } catch {}
    }
    throw error;
  }
}

function validateImageRequest(url, init) {
  if (init?.method !== "POST" || typeof init.body !== "string") {
    throw new Error("Image QA only permits a bounded Gemini JSON POST");
  }
  if (
    url.origin !== "https://generativelanguage.googleapis.com" ||
    url.pathname !== `/v1beta/models/${MODEL}:generateContent`
  ) {
    throw new Error("Image QA blocked an unapproved provider endpoint/model");
  }
  const bytes = Buffer.byteLength(init.body);
  if (bytes > MAX_REQUEST_BYTES) throw new Error("Image QA request byte cap exceeded");
  const request = JSON.parse(init.body);
  const config = request.generationConfig ?? {};
  const contents = request.contents ?? [];
  const parts = contents.flatMap((content) => content.parts ?? []);
  const modalities = config.responseModalities;
  if (
    request.tools ||
    request.toolConfig ||
    request.cachedContent ||
    (config.candidateCount != null && config.candidateCount !== 1) ||
    (config.maxOutputTokens != null && config.maxOutputTokens > MAX_IMAGE_OUTPUT_TOKENS) ||
    !Array.isArray(modalities) ||
    modalities.length !== 1 ||
    String(modalities[0]).toUpperCase() !== "IMAGE" ||
    contents.length !== 1 ||
    parts.length !== 1 ||
    typeof parts[0]?.text !== "string" ||
    parts[0].text.length === 0
  ) {
    throw new Error("Image QA blocked a request outside its one-image text-only contract");
  }
  // Apply the hard candidate/output caps at the HTTP boundary so they also
  // constrain production SDK calls that did not set those optional fields.
  request.generationConfig = {
    ...config,
    candidateCount: 1,
    maxOutputTokens: MAX_IMAGE_OUTPUT_TOKENS,
  };
  const boundedBody = JSON.stringify(request);
  if (Buffer.byteLength(boundedBody) > MAX_REQUEST_BYTES) {
    throw new Error("Capped image request exceeded its byte limit");
  }
  return {
    bytes: Buffer.byteLength(boundedBody),
    hash: sha256(boundedBody),
    init: { ...init, body: boundedBody },
  };
}

/**
 * Narrow network guard for a caller that has already reserved the shared
 * ledger run. All other external fetch/TCP activity is denied. The caller must
 * provide a reservation and call finish() after durable asset retrieval.
 */
export function installGeminiImageNetworkGuard(budgetRunOrGetter) {
  const nativeFetch = globalThis.fetch;
  const nativeConnect = net.Socket.prototype.connect;
  const externalHost = new AsyncLocalStorage();
  let physicalCount = 0;

  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const port = typeof first === "object" ? Number(first?.port) : Number(first);
    const host = typeof first === "object" ? first?.host ?? "localhost" :
      typeof args[1] === "string" ? args[1] : "localhost";
    const local = ["localhost", "127.0.0.1", "::1"].includes(host);
    if (!local && !(externalHost.getStore() === host && port === 443)) {
      throw new Error("LIVE_MEDIA_QA_SOCKET_DENIED");
    }
    return nativeConnect.apply(this, args);
  };
  syncBuiltinESMExports();

  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return nativeFetch(input, { ...init, redirect: "error" });
    }
    if (physicalCount !== 0) {
      const run = typeof budgetRunOrGetter === "function" ? budgetRunOrGetter() : budgetRunOrGetter;
      run?.markAmbiguous();
      throw new Error("LIVE_MEDIA_QA_PHYSICAL_CALL_CAP_REACHED");
    }
    const { bytes, hash, init: boundedInit } = validateImageRequest(url, init);
    const budgetRun = typeof budgetRunOrGetter === "function" ? budgetRunOrGetter() : budgetRunOrGetter;
    if (!budgetRun) throw new Error("LIVE_MEDIA_QA_RESERVATION_REQUIRED");
    const attempt = budgetRun.submit(bytes, hash);
    physicalCount += 1;
    try {
      const response = await externalHost.run(url.hostname, () => nativeFetch(input, {
        ...boundedInit,
        redirect: "error",
        signal: AbortSignal.timeout(180_000),
      }));
      let body;
      try {
        body = await response.clone().json();
      } catch {
        budgetRun.markAmbiguous();
        throw new Error("LIVE_MEDIA_QA_RESPONSE_UNREADABLE; no retry authorized");
      }
      budgetRun.receive(attempt, response, body);
      return response;
    } catch (error) {
      budgetRun.markAmbiguous();
      throw error;
    }
  };

  return () => {
    net.Socket.prototype.connect = nativeConnect;
    globalThis.fetch = nativeFetch;
    syncBuiltinESMExports();
  };
}

