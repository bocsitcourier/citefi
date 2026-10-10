import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { preservesCreditCommitments } from "../../lib/billing-adjustment-policy";

describe("admin credit adjustment commitment guard", () => {
  test("rejects removing credits already held for in-flight work", () => {
    assert.equal(
      preservesCreditCommitments({
        allowanceCredits: 100,
        purchasedCredits: 0,
        allowanceUsed: 0,
        purchasedUsed: 0,
        allowanceDebt: 0,
        purchasedDebt: 0,
        reservedCredits: 80,
      }, "allowance", -100),
      false,
    );
  });

  test("rejects removing credits already consumed in the adjusted bucket", () => {
    assert.equal(
      preservesCreditCommitments({
        allowanceCredits: 100,
        purchasedCredits: 100,
        allowanceUsed: 60,
        purchasedUsed: 0,
        allowanceDebt: 0,
        purchasedDebt: 0,
        reservedCredits: 0,
      }, "allowance", -41),
      false,
    );
  });

  test("allows a correction that removes only uncommitted balance", () => {
    assert.equal(
      preservesCreditCommitments({
        allowanceCredits: 100,
        purchasedCredits: 50,
        allowanceUsed: 20,
        purchasedUsed: 0,
        allowanceDebt: 0,
        purchasedDebt: 0,
        reservedCredits: 30,
      }, "allowance", -40),
      true,
    );
  });

  test("positive grants are unaffected and fractional corrections fail closed", () => {
    const balance = {
      allowanceCredits: 0,
      purchasedCredits: 0,
      allowanceUsed: 0,
      purchasedUsed: 0,
      allowanceDebt: 0,
      purchasedDebt: 0,
      reservedCredits: 0,
    };
    assert.equal(preservesCreditCommitments(balance, "purchased", 10), true);
    assert.equal(preservesCreditCommitments(balance, "purchased", -1.5), false);
  });

  test("adminAdjust evaluates the policy under a balance-row lock before updating", () => {
    const source = readFileSync("lib/billing.ts", "utf8");
    const start = source.indexOf("export async function adminAdjust");
    const end = source.indexOf("// Internal helper", start);
    assert.ok(start >= 0 && end > start, "adminAdjust implementation must be found");
    const implementation = source.slice(start, end);

    const lockIndex = implementation.indexOf(".for(\"update\")");
    const policyIndex = implementation.indexOf("preservesCreditCommitments(balance, bucket, amount)");
    const updateIndex = implementation.indexOf(".update(creditBalances)");
    assert.ok(lockIndex >= 0, "balance must be locked");
    assert.ok(policyIndex > lockIndex, "policy must use the locked balance");
    assert.ok(updateIndex > policyIndex, "policy must be checked before changing credits");
  });
});
