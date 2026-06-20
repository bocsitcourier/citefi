import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { getBucketBalance } from "@/lib/billing";
import { getCreditCost, CREDIT_MENU, type OperationType } from "@/lib/credit-menu";
import { z } from "zod";

const previewSchema = z.object({
  operationType: z.string().min(1),
  /** For multi-unit operations (e.g. 5 articles). Defaults to 1. */
  quantity: z.number().int().positive().default(1),
});

/**
 * GET /api/billing/preview?operationType=article&quantity=5
 *
 * Returns cost and affordability check for a proposed operation without
 * debiting anything. Used by the UI to show "this will cost N credits"
 * before the user hits Submit.
 */
export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);

    const { searchParams } = new URL(req.url);
    const parsed = previewSchema.safeParse({
      operationType: searchParams.get("operationType"),
      quantity: searchParams.get("quantity")
        ? parseInt(searchParams.get("quantity")!, 10)
        : 1,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { operationType, quantity } = parsed.data;
    const unitCost = getCreditCost(operationType);

    if (unitCost === null) {
      return NextResponse.json(
        { error: `Unknown operation type: ${operationType}` },
        { status: 400 }
      );
    }

    const totalCost = unitCost * quantity;
    const balance = await getBucketBalance(teamId);

    const canAfford = balance.totalRemaining >= totalCost;

    return NextResponse.json({
      operationType,
      quantity,
      unitCost,
      totalCost,
      balance: {
        allowanceRemaining: balance.allowanceRemaining,
        purchasedRemaining: balance.purchasedRemaining,
        totalRemaining: balance.totalRemaining,
      },
      canAfford,
      insufficientBy: canAfford ? 0 : totalCost - balance.totalRemaining,
      /** Full credit menu for display purposes */
      creditMenu: CREDIT_MENU,
    });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[billing/preview]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
