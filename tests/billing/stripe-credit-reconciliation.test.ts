import assert from "node:assert/strict";
import test from "node:test";
import {
  cumulativeCreditReversalDelta,
  proportionalCreditReversal,
  shouldReverseStripeDispute,
} from "../../lib/stripe-credit-reconciliation";

test("cumulative Stripe partial refunds reverse an exact partitioned credit total", () => {
  // Stripe reports 33, 66, then 100 cents cumulatively. The final cent must
  // not be lost to repeated per-refund flooring.
  let reversed = 0;
  for (const cumulativeRefund of [33, 66, 100]) {
    const delta = cumulativeCreditReversalDelta(10, cumulativeRefund, 100, reversed);
    reversed += delta;
  }
  assert.equal(reversed, 10);
  assert.equal(proportionalCreditReversal(10, 100, 100), 10);
});

test("created and won Stripe disputes never revoke credits; only lost does", () => {
  assert.equal(shouldReverseStripeDispute("needs_response"), false);
  assert.equal(shouldReverseStripeDispute("won"), false);
  assert.equal(shouldReverseStripeDispute("lost"), true);
});