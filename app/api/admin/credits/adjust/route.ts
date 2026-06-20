import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { adminAdjust } from "@/lib/billing";
import { z } from "zod";

const adjustSchema = z.object({
  teamId: z.number().int().positive(),
  bucket: z.enum(["allowance", "purchased"]),
  /** Positive = add credits, negative = remove credits */
  amount: z.number().int().min(-100000).max(100000),
  reason: z.string().min(1).max(500),
});

/**
 * POST /api/admin/credits/adjust
 *
 * Manually adjust a team's allowance or purchased credit bucket.
 * Positive amount adds credits; negative subtracts (floored at 0).
 */
export async function POST(request: NextRequest) {
  try {
    const { userId: adminUserId } = await requireAdmin(request);

    const body = await request.json();
    const parsed = adjustSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { teamId, bucket, amount, reason } = parsed.data;

    const newBalance = await adminAdjust({ teamId, bucket, amount, adminUserId, reason });

    return NextResponse.json({
      success: true,
      teamId,
      bucket,
      adjustment: amount,
      newBalance: {
        allowanceCredits: newBalance.allowanceCredits,
        purchasedCredits: newBalance.purchasedCredits,
        allowanceRemaining: newBalance.allowanceRemaining,
        purchasedRemaining: newBalance.purchasedRemaining,
        totalRemaining: newBalance.totalRemaining,
      },
    });
  } catch (err: any) {
    const msg = err?.message ?? "Unknown error";
    if (msg === "Authentication required") return NextResponse.json({ error: msg }, { status: 401 });
    if (msg === "Admin access required") return NextResponse.json({ error: msg }, { status: 403 });
    console.error("[admin/credits/adjust]", err);
    return NextResponse.json({ error: msg }, { status: err?.statusCode || 500 });
  }
}
