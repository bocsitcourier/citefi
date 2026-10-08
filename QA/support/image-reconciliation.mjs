import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/**
 * Native usage valuation only. Does not imply application accounting,
 * retrieval or acceptance, and does not mutate any ledger.
 */
export function valueRetainedImage(response, receipt) {
  assert.equal(receipt.status, 200);
  assert.equal(receipt.physicalCount, 1);
  assert.equal(receipt.model, "gemini-3.1-flash-image");
  assert.equal(receipt.actualModel, receipt.model);
  assert.equal(response.modelVersion, receipt.model);
  assert.equal(response.responseId, receipt.providerRequestId);
  assert.ok(typeof receipt.providerRequestId === "string" && receipt.providerRequestId.length > 0);
  assert.equal(sha256(JSON.stringify(response)), receipt.responseSha256);
  assert.deepEqual(response.usageMetadata, receipt.usage);
  assert.equal(response.candidates?.length, 1);
  assert.equal(response.candidates[0].finishReason, "STOP");
  const parts = response.candidates[0].content?.parts;
  assert.equal(parts?.length, 1);
  assert.match(parts[0].inlineData?.mimeType ?? "", /^image\/(?:jpeg|png)$/);
  assert.ok(typeof parts[0].inlineData?.data === "string" && parts[0].inlineData.data.length > 0);

  const usage = receipt.usage;
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const inputTokens = usage.promptTokenCount;
  const candidateTokens = usage.candidatesTokenCount;
  const totalTokens = usage.totalTokenCount;
  const explicitThinkingTokens = usage.thoughtsTokenCount ?? 0;
  assert.ok([inputTokens, candidateTokens, totalTokens, explicitThinkingTokens].every(integer));
  assert.equal(totalTokens, inputTokens + candidateTokens + explicitThinkingTokens);
  assert.ok(inputTokens <= 16_000 && totalTokens - inputTokens <= 2520);
  const details = usage.candidatesTokensDetails;
  assert.ok(Array.isArray(details) && details.length > 0);
  assert.ok(details.every((detail) => integer(detail.tokenCount)));
  const imageTokens = details.filter((detail) => detail.modality === "IMAGE")
    .reduce((sum, detail) => sum + detail.tokenCount, 0);
  assert.ok(imageTokens > 0 && imageTokens <= candidateTokens);
  assert.ok(details.reduce((sum, detail) => sum + detail.tokenCount, 0) <= candidateTokens);
  // Every non-image output token has the same official $3/M rate whether
  // it represents text or thinking. Do not invent a missing thoughts split.
  const nonImageOutputTokens = totalTokens - inputTokens - imageTokens;
  // Rates in microUSD per million tokens. Preserve exact rational numerator
  // and round up only for whole-microUSD budget commitments.
  const numerator = BigInt(inputTokens) * 500_000n +
    BigInt(imageTokens) * 60_000_000n +
    BigInt(nonImageOutputTokens) * 3_000_000n;
  const microusd = Number((numerator + 999_999n) / 1_000_000n);
  assert.ok(Number.isSafeInteger(microusd) && microusd > 0 && microusd <= 160_000);
  return {
    inputTokens,
    imageTokens,
    nonImageOutputTokens,
    explicitThinkingTokens: usage.thoughtsTokenCount ?? null,
    textThinkingSplitKnown: usage.thoughtsTokenCount != null,
    inputUsdPerMillion: 0.5,
    imageOutputUsdPerMillion: 60,
    nonImageOutputUsdPerMillion: 3,
    costMicrousd: microusd,
    usageEstimateUsd: microusd / 1_000_000,
    basis: "Retained native token counts and official standard rates; not an invoice or application COGS",
  };
}
