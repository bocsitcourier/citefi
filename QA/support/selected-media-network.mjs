import { AsyncLocalStorage } from "node:async_hooks";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { LIMITS, hash, assertPaidMediaPermission } from "./selected-media-plan.mjs";

const GOOGLE = "https://generativelanguage.googleapis.com";
const OPENAI = "https://api.openai.com";
const integer = (n) => Number.isSafeInteger(n) && n >= 0;

export function validateSelectedSubmission(stage, url, init, receipt) {
  if (init?.method !== "POST" || typeof init.body !== "string") throw new Error("Bounded JSON POST required");
  const body = JSON.parse(init.body);
  if (!receipt?.sourceEventId || !Number.isSafeInteger(receipt.teamId) ||
      receipt.teamId <= 0) throw new Error("Owned prepared provider receipt required");
  if (receipt.attempt !== 1) throw new Error("Physical receipt retries are not approved");
  if (url.origin === GOOGLE && /^\/v1(?:beta)?\/models\/gemini-3\.5-flash:generateContent$/.test(url.pathname)) {
    const config = body.generationConfig ?? {};
    const contents = body.contents;
    if (receipt.operationType !== (stage === "podcast" ? "podcast_script" : "video_script") ||
        receipt.model !== LIMITS.scriptModel || body.tools || body.toolConfig ||
        body.cachedContent || body.systemInstruction ||
        Buffer.byteLength(init.body) > LIMITS.scriptBytes ||
        config.maxOutputTokens !== LIMITS.scriptOutputTokens ||
        (config.candidateCount !== undefined && config.candidateCount !== 1) ||
        config.responseMimeType !== "application/json" ||
        Object.keys(body).some(k => !["contents", "generationConfig"].includes(k)) ||
        Object.keys(config).some(k => !["maxOutputTokens", "responseMimeType", "temperature", "candidateCount"].includes(k)) ||
        (config.candidateCount != null && config.candidateCount !== 1) ||
        !Array.isArray(contents) || contents.length !== 1 ||
        !Array.isArray(contents[0].parts) || contents[0].parts.length !== 1 ||
        typeof contents[0].parts[0]?.text !== "string") throw new Error("Unapproved script/auxiliary request");
    return { kind: "script", body: { ...body, model: LIMITS.scriptModel } };
  }
  if (url.origin === OPENAI && url.pathname === "/v1/audio/speech") {
    if (receipt.model !== LIMITS.ttsModel || body.model !== LIMITS.ttsModel ||
        receipt.operationType !== (stage === "podcast" ? "podcast_tts" : "video_tts") ||
        typeof body.input !== "string" || body.input.length === 0 ||
        body.input.length > LIMITS.ttsSegmentCharacters ||
        /[\uD800-\uDFFF]/.test(body.input) ||
        !["nova", "onyx", "alloy", "echo", "fable", "shimmer"].includes(body.voice) ||
        body.instructions || body.stream_format ||
        (body.response_format != null && body.response_format !== "mp3") ||
        (body.speed != null && (body.speed < 0.8 || body.speed > 1.2))) {
      throw new Error("Unapproved speech model/characters/voice/format");
    }
    return { kind: "tts", body };
  }
  if (stage === "video" && url.origin === GOOGLE &&
      /^\/v1(?:beta)?\/models\/veo-3\.1-fast-generate-preview:predictLongRunning$/.test(url.pathname)) {
    const p = body.parameters ?? {};
    if (receipt.operationType !== "veo_clip" || receipt.model !== LIMITS.videoModel ||
        body.instances?.length !== 1 ||
        Object.keys(body.instances[0]).some(k => k !== "prompt") ||
        typeof body.instances[0].prompt !== "string" ||
        !body.instances[0].prompt.trim() || Buffer.byteLength(init.body) > 8192 ||
        p.durationSeconds !== LIMITS.clipSeconds || p.resolution !== LIMITS.resolution ||
        p.sampleCount !== 1 || p.aspectRatio !== "16:9" ||
        Object.keys(p).some(k => !["durationSeconds", "resolution", "sampleCount", "aspectRatio"].includes(k))) {
      throw new Error("Unapproved Veo duration/resolution/count/input");
    }
    return { kind: "clip", body: { ...body, model: LIMITS.videoModel } };
  }
  throw new Error("Unapproved paid endpoint/model");
}

export function valueScriptUsage(body) {
  const u = body?.usageMetadata;
  if (!u || !integer(u.promptTokenCount) || !integer(u.totalTokenCount) ||
      u.promptTokenCount > LIMITS.scriptInputTokens ||
      !integer(u.candidatesTokenCount) ||
      (u.thoughtsTokenCount != null && !integer(u.thoughtsTokenCount))) throw new Error("Unusable script usage");
  const output = u.totalTokenCount - u.promptTokenCount;
  if (!integer(output) || output !== u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0) ||
      output > LIMITS.scriptOutputTokens || body.candidates?.length !== 1 ||
      body.candidates[0].finishReason !== "STOP" || !body.responseId) {
    throw new Error("Incomplete/truncated script or inconsistent thinking usage");
  }
  return { inputTokens: u.promptTokenCount, outputTokensIncludingThinking: output,
    costMicrousd: Math.ceil(u.promptTokenCount * 1.5 + output * 9) };
}

async function boundedBytes(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty provider body");
  const buffers = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMITS.assetBytes) throw new Error("Provider response exceeded byte cap");
      buffers.push(Buffer.from(value));
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return Buffer.concat(buffers);
}

function videoUris(body) {
  const generated = body.response?.generateVideoResponse?.generatedSamples ??
    body.response?.generatedVideos ?? [];
  return generated.map(v => v.video?.uri).filter(v => typeof v === "string");
}

/**
 * Every paid POST is reserved durably before native fetch. Unknown submissions
 * retain the stage lock. Poll/download admission depends on a durable native
 * operation acknowledgement, not guessed names. No SDK fallback can escape
 * the endpoint, receipt, duplicate-hash and physical-count checks.
 */
export function installSelectedMediaNetworkGuard(getRun, getReceipt, options = {}) {
  const nativeFetch = globalThis.fetch;
  const nativeConnect = net.Socket.prototype.connect;
  const external = new AsyncLocalStorage();
  const operations = new Map();
  const downloads = new Map();
  const request = async (url, input, init, timeout) => {
    const run = getRun();
    if (!run) throw new Error("Selected media reservation required");
    const remaining = run.remainingMs();
    if (remaining <= 0) throw new Error("Selected media stage deadline reached");
    const args = { ...init, redirect: "error", signal: AbortSignal.timeout(Math.min(timeout, remaining)) };
    if (run.offline) {
      if (!options.fixtureFetch) throw new Error("Offline selected QA requires a fixture transport");
      return options.fixtureFetch(input, args);
    }
    if (options.fixtureFetch) throw new Error("Live QA refuses fixture transport");
    return external.run(url.hostname, () => nativeFetch(input, args));
  };
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const port = typeof first === "object" ? Number(first?.port) : Number(first);
    const host = typeof first === "object" ? first?.host ?? "localhost" :
      typeof args[1] === "string" ? args[1] : "localhost";
    if (!["localhost", "127.0.0.1", "::1"].includes(host) &&
        !(external.getStore() === host && port === 443)) throw new Error("SELECTED_MEDIA_SOCKET_DENIED");
    return nativeConnect.apply(this, args);
  };
  syncBuiltinESMExports();
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
      return nativeFetch(input, { ...init, redirect: "error" });
    }
    const run = getRun();
    if (!run) throw new Error("Selected media reservation required");
    if (run.isStopped()) throw new Error("Selected media stopped; no further provider traffic");
    try {
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (method === "POST") {
        const { kind, body } = validateSelectedSubmission(run.stage, url, init, getReceipt());
        if (!run.offline && assertPaidMediaPermission(run.stage) !== run.entry.manifestSha256) {
          throw new Error("Execution manifest changed; no further paid calls authorized");
        }
        const call = run.submit(kind, body, getReceipt().sourceEventId);
        const response = await request(url, input, init,
          kind === "tts" ? LIMITS.ttsTimeoutMs : LIMITS.scriptTimeoutMs);
        const bytes = await boundedBytes(response.clone());
        if (kind === "tts") {
          run.writeBytes(`call-${call.number}-native.mp3`, bytes);
          if (!response.ok || !response.headers.get("x-request-id") || bytes.length < 1000) {
            throw new Error("Speech rejected or unusable; no retry/fallback");
          }
          run.capture(call, { providerRequestId: response.headers.get("x-request-id"),
            nativeSha256: hash(bytes), characters: body.input.length,
            billingBasis: "exact request characters; not an invoice" }, body.input.length * 15);
        } else {
          run.writeBytes(`call-${call.number}-native.json`, bytes);
          const native = JSON.parse(bytes);
          if (!response.ok) throw new Error("Provider rejected; no retry/fallback");
          if (kind === "script") {
            const usage = valueScriptUsage(native);
            run.capture(call, { providerRequestId: native.responseId, nativeSha256: hash(bytes),
              ...usage }, usage.costMicrousd);
          } else {
            const name = native.name;
            if (typeof name !== "string" ||
                !/^(?:models\/veo-3\.1-fast-generate-preview\/)?operations\/[a-zA-Z0-9_-]{1,160}$/.test(name) ||
                operations.has(name)) throw new Error("Unusable/reused Veo operation ID");
            // fsynced before the SDK receives the acknowledgement and can poll.
            run.writeEvidence(`call-${call.number}-operation.json`, {
              operationName: name, sourceEventId: call.sourceEventId, nativeSha256: hash(bytes),
              acknowledgedAt: new Date().toISOString(), pollsMaximum: LIMITS.pollsPerClip,
              elapsedMsMaximum: LIMITS.pollElapsedMs,
            });
            operations.set(name, { call, started: Date.now(), polls: 0, complete: false });
            if (native.done) completeOperation(run, operations.get(name), native);
          }
        }
        return response;
      }
      if (method !== "GET" || url.origin !== GOOGLE) throw new Error("Unapproved provider poll/download");
      const name = url.pathname.replace(/^\/v1(?:beta)?\//, "");
      const op = operations.get(name);
      if (op) {
        if (op.complete || ++op.polls > LIMITS.pollsPerClip ||
            Date.now() - op.started >= LIMITS.pollElapsedMs) throw new Error("Veo poll count/time cap reached");
        const remaining = LIMITS.pollElapsedMs - (Date.now() - op.started);
        const response = await request(url, input, init, Math.min(remaining, LIMITS.pollTimeoutMs));
        const bytes = await boundedBytes(response.clone());
        run.writeBytes(`call-${op.call.number}-poll-${op.polls}.json`, bytes);
        if (!response.ok) throw new Error("Veo poll rejected; stop with operation retained");
        const body = JSON.parse(bytes);
        if (body.name !== name) throw new Error("Poll returned a different operation");
        if (body.done) completeOperation(run, op, body);
        return response;
      }
      const normalized = new URL(url);
      normalized.searchParams.delete("key"); // SDK may append its injected key.
      const download = downloads.get(normalized.href);
      if (!download || download.requested) throw new Error("Unapproved/repeated native asset download");
      download.requested = true;
      const response = await request(url, input, init, LIMITS.scriptTimeoutMs);
      const bytes = await boundedBytes(response.clone());
      run.writeBytes(`call-${download.call.number}-native.mp4`, bytes);
      if (!response.ok || bytes.length < 1000) throw new Error("Veo download failed; no paid replay");
      run.writeEvidence(`call-${download.call.number}-download.json`, {
        bytes: bytes.length, sha256: hash(bytes), operationName: download.operationName,
        sourceEventId: download.call.sourceEventId,
      });
      return response;
    } catch (error) {
      run.stop(error instanceof Error ? error.message : "Unknown guarded media failure");
      throw error;
    }
  };

  function completeOperation(run, op, body) {
    const uris = videoUris(body);
    if (body.error || uris.length !== 1) throw new Error("Veo operation failed/missing video; retain hold");
    const uri = new URL(uris[0]);
    if (uri.origin !== GOOGLE || uri.username || uri.password ||
        !/^\/(?:download\/)?v1(?:beta)?\/files\//.test(uri.pathname) ||
        uri.searchParams.has("key") || downloads.has(uri.href)) throw new Error("Unapproved native video URI");
    run.capture(op.call, { providerRequestId: body.name, videoSeconds: LIMITS.clipSeconds,
      operationName: body.name, polls: op.polls,
      billingBasis: "native completion of requested duration; decoded duration checked separately" },
    LIMITS.clipSeconds * 100000);
    op.complete = true;
    downloads.set(uri.href, { call: op.call, operationName: body.name, requested: false });
  }
  return () => {
    globalThis.fetch = nativeFetch;
    net.Socket.prototype.connect = nativeConnect;
    syncBuiltinESMExports();
  };
}
