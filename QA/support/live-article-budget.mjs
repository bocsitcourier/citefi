import { createHash } from "node:crypto";
import { mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const ROOT = resolve("QA/evidence/live-current");
export const PLAN = Object.freeze({
  version: 2, ceilingUsd: 30, articleSubcapUsd: 2,
  mode: "standard-text-only-no-tools-no-cache-no-priority",
  syntheticBoundary: "Owned synthetic tenants, research/SEO cache; genuine provider text, Guardian and final judge",
  skipped: ["optional enhancement", "optional critic", "image generation", "publication", "email"],
  calls: [
    { role: "article", provider: "gemini", model: "gemini-3.5-flash",
      maxInputBytes: 120000, inputOverheadTokens: 8192, maxOutputTokens: 16384,
      thinkingConfig: { thinkingLevel: "MINIMAL" },
      inputUsdPerMillion: 1.5, outputUsdPerMillion: 9, maxPhysicalCalls: 1,
      source: "google-pricing-source.md", url: "https://ai.google.dev/gemini-api/docs/pricing" },
    { role: "judge", provider: "openai", model: "gpt-4.1-mini",
      maxInputBytes: 50000, inputOverheadTokens: 8192, maxOutputTokens: 2048,
      inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6, maxPhysicalCalls: 1,
      source: "openai-gpt41mini-pricing-source.md", url: "https://platform.openai.com/docs/models/gpt-4.1-mini" },
  ],
});
function canonicalBudgetBaseline() {
  const file = "QA/evidence/live-current/budget-baseline.json";
  const text = readFileSync(resolve(file), "utf8");
  const record = JSON.parse(text);
  if (record.version !== 1 || record.ceilingUsd !== PLAN.ceilingUsd ||
      !Number.isFinite(record.knownPriorUsd) || record.knownPriorUsd <= 0 ||
      !Number.isFinite(record.historicalHoldUsd) || record.historicalHoldUsd <= 0 ||
      record.historicalCalls !== "UNKNOWN / UNRECONCILED" ||
      record.knownPriorUsd + record.historicalHoldUsd >= record.ceilingUsd) {
    throw new Error("Invalid canonical total-budget baseline");
  }
  return { ...record, sourceFile: file, sourceSha256: sha256(text) };
}
function budgetAccounting(baseline, runs) {
  // Round every new commitment UP to whole microdollars; never increase
  // available funds through fractional-microdollar arithmetic.
  const newCommittedMicrousd = runs.reduce((sum, run) => {
    const amount = run.state === "settled" ? run.actualUsd : run.reservedUsd;
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid ledger amount");
    return sum + Math.ceil(amount * 1e6);
  }, 0);
  return {
    ceilingUsd: baseline.ceilingUsd,
    knownPriorUsd: baseline.knownPriorUsd,
    historicalHoldUsd: baseline.historicalHoldUsd,
    historicalHoldIsActualSpend: false,
    historicalCalls: baseline.historicalCalls,
    newCommittedUsd: newCommittedMicrousd / 1e6,
    availableUsd: (Math.round(baseline.ceilingUsd * 1e6) -
      Math.round(baseline.knownPriorUsd * 1e6) -
      Math.round(baseline.historicalHoldUsd * 1e6) - newCommittedMicrousd) / 1e6,
  };
}
export function durableJson(path, data) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  const fd = openSync(temp, "w", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temp, path);
  const dir = openSync(dirname(path), "r");
  try { fsyncSync(dir); } finally { closeSync(dir); }
}
export function preflight() {
  const budgetBaseline = canonicalBudgetBaseline();
  const ledgerPath = join(ROOT, "budget-ledger.json");
  const existing = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : null;
  if (existing && (existing.budgetBaseline?.sourceSha256 !== budgetBaseline.sourceSha256 ||
      !Array.isArray(existing.runs))) throw new Error("Shared ledger baseline mismatch; reconcile before continuing");
  const totalBudget = budgetAccounting(budgetBaseline, existing?.runs ?? []);
  if (totalBudget.availableUsd < PLAN.articleSubcapUsd) throw new Error("Total USD30 budget cannot cover article reservation");
  const sources = PLAN.calls.map((call) => {
    const path = join(ROOT, call.source);
    if (!existsSync(path)) throw new Error(`Verified pricing source required: ${call.source}`);
    const text = readFileSync(path, "utf8");
    if (text.length < 100) throw new Error("Pricing source is empty or incomplete");
    return { file: call.source, sha256: sha256(text), url: call.url,
      verification: "Parent verified official standard pricing; no cache/tool/priority rates used" };
  });
  const maximumUsd = PLAN.calls.reduce((sum, call) =>
    sum + ((call.maxInputBytes + call.inputOverheadTokens) * call.inputUsdPerMillion +
      call.maxOutputTokens * call.outputUsdPerMillion) / 1e6, 0);
  if (!(maximumUsd > 0 && maximumUsd <= PLAN.articleSubcapUsd)) throw new Error("Article subcap exceeded");
  const report = { ...PLAN, sources, maximumUsd, budgetBaseline, totalBudget,
    configurationSha256: sha256(JSON.stringify(PLAN)),
    thinkingControlSource: {
      file: "thinking-controls-source.md",
      sha256: sha256(readFileSync(join(ROOT, "thinking-controls-source.md"), "utf8")),
      url: "https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.5",
      limitation: "MINIMAL is supported effort control, not a guarantee of zero thinking tokens",
    },
    inputBound: "Serialized UTF-8 bytes plus 8192 protocol/schema tokens; text-only inputs",
    outputBound: "Gemini total output cap includes thinking; OpenAI completion cap 2048",
    historicalCalls: "UNKNOWN / UNRECONCILED; known prior valuation and conservative historical HOLD both reduce the total USD30 availability",
    createdAt: new Date().toISOString() };
  durableJson(join(ROOT, "preflight.json"), report);
  return report;
}

export function requireArchitectApproval(runId, report, approval) {
  if (!runId || !/^[a-z0-9-]{1,80}$/.test(runId)) throw new Error("Unique explicit case ID required");
  if (approval?.decision !== "APPROVED" || approval.caseId !== runId ||
      approval.configurationSha256 !== report.configurationSha256 ||
      approval.baselineSha256 !== report.budgetBaseline.sourceSha256 ||
      typeof approval.reviewEvidence !== "string" || !approval.reviewEvidence) {
    throw new Error("Architect approval for this exact case/configuration required before spending");
  }
}

// One shared lock/ledger across every run and helper. A crash leaves the lock
// and pending reservation intact: a human must reconcile before removing it.
export function reserveRun(runId, report) {
  if (!/^[a-z0-9-]{1,80}$/.test(runId)) throw new Error("Invalid run ID");
  mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const lockPath = join(ROOT, "budget.lock");
  const lock = openSync(lockPath, "wx", 0o600);
  writeFileSync(lock, JSON.stringify({ runId, pid: process.pid })); fsyncSync(lock);
  closeSync(lock);
  const ledgerPath = join(ROOT, "budget-ledger.json");
  const budgetBaseline = canonicalBudgetBaseline();
  if (report.budgetBaseline?.sourceSha256 !== budgetBaseline.sourceSha256) throw new Error("Preflight baseline changed");
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) :
    { version: 2, ceilingUsd: PLAN.ceilingUsd, budgetBaseline, runs: [] };
  if (ledger.version !== 2 || ledger.ceilingUsd !== PLAN.ceilingUsd ||
      ledger.budgetBaseline?.sourceSha256 !== budgetBaseline.sourceSha256 ||
      !Array.isArray(ledger.runs)) throw new Error("Invalid shared ledger or historical baseline");
  if (ledger.runs.some((run) => run.runId === runId)) throw new Error("Run already reserved; replay prohibited");
  if (budgetAccounting(budgetBaseline, ledger.runs).availableUsd < PLAN.articleSubcapUsd) {
    throw new Error("Shared total USD30 budget exhausted after known prior valuation and historical HOLD");
  }
  const directory = join(ROOT, runId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  durableJson(join(directory, "preflight.json"), report);
  const entry = { runId, state: "pending", reservedUsd: PLAN.articleSubcapUsd, calls: [], createdAt: new Date().toISOString() };
  ledger.runs.push(entry);
  const persist = () => {
    ledger.totalBudget = budgetAccounting(budgetBaseline, ledger.runs);
    durableJson(ledgerPath, ledger);
  };
  persist();
  let halted = false;
  const submit = (call, bytes, hash) => {
    if (halted || entry.calls.some((attempt) => attempt.role === call.role)) {
      throw new Error("Paid retry or subsequent ambiguous submission prohibited");
    }
    const attempt = { role: call.role, provider: call.provider, model: call.model,
      requestSha256: hash, inputBytes: bytes, maxInputTokens: bytes + call.inputOverheadTokens,
      maxOutputTokens: call.maxOutputTokens, physicalCount: 1, state: "pending",
      ...(call.thinkingConfig ? { thinkingConfig: call.thinkingConfig } : {}),
      inputUsdPerMillion: call.inputUsdPerMillion, outputUsdPerMillion: call.outputUsdPerMillion,
      maximumUsd: ((bytes + call.inputOverheadTokens) * call.inputUsdPerMillion +
        call.maxOutputTokens * call.outputUsdPerMillion) / 1e6,
      submittedAt: new Date().toISOString() };
    entry.calls.push(attempt); persist(); // durable BEFORE external fetch
    durableJson(join(directory, `${call.role}-request.json`), attempt);
    return attempt;
  };
  const receive = (call, attempt, response, data) => {
    const usage = call.provider === "gemini" ? data.usageMetadata : data.usage;
    const input = call.provider === "gemini" ? usage?.promptTokenCount : usage?.prompt_tokens;
    const output = call.provider === "gemini"
      ? usage?.candidatesTokenCount + (usage?.thoughtsTokenCount ?? 0) : usage?.completion_tokens;
    const requestId = data.responseId ?? data.id ?? response.headers.get("x-request-id");
    const model = data.modelVersion ?? data.model;
    const known = response.ok && !!requestId && typeof model === "string" &&
      Number.isInteger(input) && input >= 0 && Number.isInteger(output) && output >= 0 &&
      input <= attempt.maxInputTokens && output <= call.maxOutputTokens &&
      (model === call.model || model.startsWith(`${call.model}-`));
    const receipt = { ...attempt, status: response.status, providerRequestId: requestId ?? null,
      actualModel: model ?? null, usage: usage ?? null, responseSha256: sha256(JSON.stringify(data)),
      costBasis: "Conservative standard-rate usage estimate, not provider billing reconciliation; cached tokens charged at full input rate",
      actualUsd: known ? (input * call.inputUsdPerMillion + output * call.outputUsdPerMillion) / 1e6 : null,
      state: known ? "receipted" : "ambiguous", receivedAt: new Date().toISOString() };
    // Independent durable receipt survives DB insertion or ledger failure.
    durableJson(join(directory, `${call.role}-receipt.json`), receipt);
    durableJson(join(directory, `${call.role}-output.json`), {
      providerRequestId: requestId ?? null, model: model ?? null,
      candidates: data.candidates ?? null, choices: data.choices ?? null, usage: usage ?? null,
    });
    Object.assign(attempt, receipt); persist();
    if (!known) { halted = true; throw new Error("Ambiguous provider outcome; reservation retained, no replay"); }
  };
  return {
    directory, submit, receive,
    halt() { halted = true; },
    finish(outcome) {
      if (outcome.endToEndPass && (entry.calls.length !== PLAN.calls.length ||
          !PLAN.calls.every((planned) => entry.calls.some((call) =>
            call.role === planned.role && call.state === "receipted")))) {
        throw new Error("Cannot certify without genuine receipted article and judge calls");
      }
      durableJson(join(directory, "outcome.json"), {
        ...outcome, physicalCounts: entry.calls.map(({ role, physicalCount }) => ({ role, physicalCount })),
        totalBudget: budgetAccounting(budgetBaseline, ledger.runs),
        spendUsd: entry.calls.every((call) => call.state === "receipted")
          ? entry.calls.reduce((sum, call) => sum + call.actualUsd, 0) : null,
      });
      if (!halted && entry.calls.every((call) => call.state === "receipted")) {
        entry.state = "settled";
        entry.actualUsd = entry.calls.reduce((sum, call) => sum + call.actualUsd, 0);
        persist();
        durableJson(join(directory, "budget-settlement.json"), {
          runId, state: entry.state, newRunUsageEstimateUsd: entry.actualUsd,
          remainingReservedUsd: 0,
          totalBudget: ledger.totalBudget, budgetBaseline,
        });
        unlinkSync(lockPath);
      }
    },
  };
}

export function validateRequest(url, init) {
  if (init?.method !== "POST" || typeof init.body !== "string") throw new Error("Unsupported provider request");
  let call;
  if (url.origin === "https://generativelanguage.googleapis.com" &&
      url.pathname === "/v1beta/models/gemini-3.5-flash:generateContent") call = PLAN.calls[0];
  if (url.origin === "https://api.openai.com" && url.pathname === "/v1/chat/completions") call = PLAN.calls[1];
  if (!call) throw new Error("Unapproved provider endpoint");
  const body = JSON.parse(init.body);
  const bytes = Buffer.byteLength(init.body);
  if (bytes > call.maxInputBytes) throw new Error("Input byte bound exceeded");
  if (body.tools || body.toolConfig || body.cachedContent || body.stream || body.service_tier ||
      body.batch || body.file || body.generationConfig?.candidateCount > 1) {
    throw new Error("Tools/cache/stream/priority/batch/multiple candidates are not authorized");
  }
  if (call.provider === "gemini") {
    if (Object.keys(body).some((key) => !["contents", "generationConfig"].includes(key)) ||
        Object.keys(body.generationConfig ?? {}).some((key) =>
          !["maxOutputTokens", "thinkingConfig", "responseMimeType", "responseSchema", "responseJsonSchema"].includes(key))) {
      throw new Error("Unapproved Gemini request fields");
    }
    const parts = body.contents?.flatMap((content) => content.parts ?? []);
    if (!parts?.length || parts.some((part) => typeof part.text !== "string" || Object.keys(part).some((key) => key !== "text"))) {
      throw new Error("Only text Gemini input is authorized");
    }
    if (body.generationConfig?.maxOutputTokens !== call.maxOutputTokens) throw new Error("Gemini output cap mismatch");
    const thinking = body.generationConfig?.thinkingConfig;
    if (!thinking || Object.keys(thinking).length !== 1 ||
        thinking.thinkingLevel !== call.thinkingConfig.thinkingLevel) {
      throw new Error("Gemini thinking configuration mismatch");
    }
  } else {
    if (Object.keys(body).some((key) =>
      !["model", "messages", "temperature", "max_tokens", "response_format"].includes(key))) {
      throw new Error("Unapproved judge request fields");
    }
    if (body.model !== call.model || body.max_tokens !== call.maxOutputTokens ||
        body.n && body.n !== 1 || !Array.isArray(body.messages) ||
        body.messages.some((message) => typeof message.content !== "string")) {
      throw new Error("Judge model/output/input mismatch");
    }
    if (body.messages.length !== 1 || body.messages[0].role !== "user" ||
        !body.messages[0].content.startsWith("You are a strict editorial reviewer.")) {
      throw new Error("Only the production finalization judge is authorized");
    }
  }
  return { call, bytes, hash: sha256(init.body) };
}

export function installNetworkGuard(budget) {
  const nativeFetch = globalThis.fetch;
  const connect = net.Socket.prototype.connect;
  const external = new AsyncLocalStorage();
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const port = typeof first === "object" ? Number(first?.port) : Number(first);
    const host = typeof first === "object" ? first?.host ?? "localhost" :
      typeof args[1] === "string" ? args[1] : "localhost";
    const local = ["localhost", "127.0.0.1", "::1"].includes(host) && [5110, 55490, 16390].includes(port);
    if (!local && !(external.getStore() === host && port === 443)) throw new Error("LIVE_QA_SOCKET_DENIED");
    return connect.apply(this, args);
  };
  syncBuiltinESMExports();
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "http://127.0.0.1:5110") return nativeFetch(input, { ...init, redirect: "error" });
    const { call, bytes, hash } = validateRequest(url, init);
    const attempt = budget.submit(call, bytes, hash);
    try {
      const response = await external.run(url.hostname, () => nativeFetch(input, {
        ...init, redirect: "error", signal: AbortSignal.timeout(180000),
      }));
      const data = await response.clone().json();
      budget.receive(call, attempt, response, data);
      return response;
    } catch {
      budget.halt();
      throw new Error("LIVE_PROVIDER_OUTCOME_UNCERTAIN; no paid replay authorized");
    }
  };
}