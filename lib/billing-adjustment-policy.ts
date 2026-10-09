export interface CreditAdjustmentBalance {
  allowanceCredits: number;
  purchasedCredits: number;
  allowanceUsed: number;
  purchasedUsed: number;
  allowanceDebt: number;
  purchasedDebt: number;
  reservedCredits: number;
}

/**
 * A negative manual adjustment may remove only uncommitted credits. The balance
 * row must be locked by the caller while evaluating and applying this policy.
 */
export function preservesCreditCommitments(
  balance: CreditAdjustmentBalance,
  bucket: "allowance" | "purchased",
  amount: number,
): boolean {
  if (!Number.isInteger(amount)) return false;
  if (amount >= 0) return true;
  // Reject over-removal rather than clamping and recording an inaccurate ledger delta.
  if ((bucket === "allowance" ? balance.allowanceCredits : balance.purchasedCredits) + amount < 0) return false;

  const allowanceCredits = bucket === "allowance"
    ? Math.max(0, balance.allowanceCredits + amount)
    : balance.allowanceCredits;
  const purchasedCredits = bucket === "purchased"
    ? Math.max(0, balance.purchasedCredits + amount)
    : balance.purchasedCredits;

  if (allowanceCredits < balance.allowanceUsed + balance.allowanceDebt) return false;
  if (purchasedCredits < balance.purchasedUsed + balance.purchasedDebt) return false;

  const available =
    Math.max(0, allowanceCredits - balance.allowanceUsed - balance.allowanceDebt) +
    Math.max(0, purchasedCredits - balance.purchasedUsed - balance.purchasedDebt) -
    balance.reservedCredits;
  return available >= 0;
}
