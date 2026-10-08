import assert from "node:assert/strict";
import test from "node:test";
import { sha256, valueRetainedImage } from "../../QA/support/image-reconciliation.mjs";

function fixture(overrides = {}) {
  const response = {
    responseId: "fixture-offline-only",
    modelVersion: "gemini-3.1-flash-image",
    candidates: [{
      finishReason: "STOP",
      content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: "offline-bytes-not-decoded-here" } }] },
    }],
    usageMetadata: {
      promptTokenCount: 172, candidatesTokenCount: 1612, totalTokenCount: 1784,
      candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1120 }],
      ...overrides,
    },
  };
  const receipt = {
    status: 200, physicalCount: 1, model: response.modelVersion, actualModel: response.modelVersion,
    providerRequestId: response.responseId, usage: response.usageMetadata,
    responseSha256: sha256(JSON.stringify(response)),
  };
  return { response, receipt };
}

test("price the complete native image/non-image split without inventing thoughts", () => {
  const { response, receipt } = fixture();
  const value = valueRetainedImage(response, receipt);
  assert.equal(value.costMicrousd, 68_762);
  assert.equal(value.nonImageOutputTokens, 492);
  assert.equal(value.explicitThinkingTokens, null);
  assert.equal(value.textThinkingSplitKnown, false);
});

test("explicit thoughts are included once at the text/thinking rate", () => {
  const { response, receipt } = fixture({ thoughtsTokenCount: 10, totalTokenCount: 1794 });
  assert.equal(valueRetainedImage(response, receipt).costMicrousd, 68_792);
});

test("inconsistent totals, missing image usage and exceeded output caps fail closed", () => {
  for (const overrides of [
    { totalTokenCount: 1783 },
    { candidatesTokensDetails: [] },
    { candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1800 }] },
    { candidatesTokenCount: 3000, totalTokenCount: 3172 },
    { promptTokenCount: -1 },
  ]) {
    const { response, receipt } = fixture(overrides);
    assert.throws(() => valueRetainedImage(response, receipt));
  }
});

test("changed native response hash or provider identity cannot reconcile", () => {
  const { response, receipt } = fixture();
  assert.throws(() => valueRetainedImage({ ...response, responseId: "different" }, receipt));
  assert.throws(() => valueRetainedImage(response, { ...receipt, physicalCount: 2 }));
  assert.throws(() => valueRetainedImage(response, { ...receipt, responseSha256: "changed" }));
});
