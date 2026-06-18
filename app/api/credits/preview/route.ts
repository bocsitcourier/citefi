import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { getCreditBalance, CREDIT_COSTS, type ProductType } from "@/lib/credits";

/**
 * GET /api/credits/preview?product=article&units=5
 *
 * Returns the credit cost for a requested operation before the user commits,
 * plus their current balance and whether they can afford it.
 *
 * Query params:
 *   product  — one of: article | podcast | video | social
 *   units    — integer >= 1 (default: 1)
 */
export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const { searchParams } = new URL(request.url);
    const product = searchParams.get("product") as ProductType | null;
    const unitsRaw = parseInt(searchParams.get("units") ?? "1", 10);

    if (!product || !(product in CREDIT_COSTS)) {
      return NextResponse.json(
        {
          error: "Invalid product",
          validProducts: Object.keys(CREDIT_COSTS),
        },
        { status: 400 }
      );
    }

    const units = Math.max(1, Math.min(unitsRaw, 10_000));
    const creditCost = CREDIT_COSTS[product] * units;
    const currentBalance = await getCreditBalance(teamId);

    return NextResponse.json({
      product,
      units,
      creditCostPerUnit: CREDIT_COSTS[product],
      creditCost,
      currentBalance,
      canAfford: currentBalance >= creditCost,
      deficit: currentBalance < creditCost ? creditCost - currentBalance : 0,
    });
  } catch (err: any) {
    const msg = err?.message ?? "Unknown error";
    const status =
      msg === "Authentication required" ? 401
      : msg === "Admin access required" ? 403
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
