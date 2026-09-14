import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstBatchFailureReason,
  getBatchProgressPollInterval,
} from "../../lib/batch-progress";

void test("terminal batch keeps polling until child statuses settle", () => {
  assert.equal(getBatchProgressPollInterval({
    status: "FAILED",
    inProgress: 1,
    pending: 0,
  }), 1500);
  assert.equal(getBatchProgressPollInterval({
    status: "FAILED",
    inProgress: 0,
    pending: 0,
  }), false);
});

void test("failed article reason is surfaced verbatim", () => {
  assert.equal(firstBatchFailureReason([
    { articleStatus: "IN_PROGRESS", errorMessage: null },
    { articleStatus: "FAILED", errorMessage: "Provider accounting failed" },
  ]), "Provider accounting failed");
});