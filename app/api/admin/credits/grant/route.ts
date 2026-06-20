import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { grantCredits } from "@/lib/credits";
import { grantAllowance, grantPurchased } from "@/lib/billing";
import { z } from "zod";

const grantSchema = z.object({
  teamId: z.number().int().positive(),
  amount: z.number().int().min(1).max(100000),
  /**
   * Which bucket to credit.
   * - "legacy"    → old lib/credits.ts combined balance (default for backward compat)
   * - "allowance" → two-bucket allowance (resets monthly); requires periodStart + periodEnd
   * - "purchased" → two-bucket purchased top-up (never expires)
   */
  bucket: z.enum(["legacy", "allowance", "purchased"]).default("purchased"),
  reason: z.string().min(1).max(500).optional(),
  /** ISO 8601 — required when bucket = "allowance" */
  periodStart: z.string().optional(),
  /** ISO 8601 — required when bucket = "allowance" */
  periodEnd: z.string().optional(),
  idempotencyKey: z.string().max(255).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { userId: adminUserId } = await requireAdmin(request);

    const body = await request.json();
    const parsed = grantSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const { teamId, amount, bucket, reason, periodStart, periodEnd, idempotencyKey } = parsed.data;

    if (bucket === "allowance") {
      if (!periodStart || !periodEnd) {
        return NextResponse.json(
          { error: "periodStart and periodEnd are required for allowance grants" },
          { status: 400 }
        );
      }
      const newBalance = await grantAllowance({
        teamId,
        amount,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        adminUserId,
        reason,
        idempotencyKey,
      });
      return NextResponse.json({
        success: true,
        teamId,
        bucket,
        amountGranted: amount,
        newBalance: {
          allowanceCredits: newBalance.allowanceCredits,
          purchasedCredits: newBalance.purchasedCredits,
          allowanceRemaining: newBalance.allowanceRemaining,
          purchasedRemaining: newBalance.purchasedRemaining,
          totalRemaining: newBalance.totalRemaining,
        },
      });
    }

    if (bucket === "purchased") {
      const newBalance = await grantPurchased({ teamId, amount, adminUserId, reason, idempotencyKey });
      return NextResponse.json({
        success: true,
        teamId,
        bucket,
        amountGranted: amount,
        newBalance: {
          allowanceCredits: newBalance.allowanceCredits,
          purchasedCredits: newBalance.purchasedCredits,
          allowanceRemaining: newBalance.allowanceRemaining,
          purchasedRemaining: newBalance.purchasedRemaining,
          totalRemaining: newBalance.totalRemaining,
        },
      });
    }

    // Default legacy path — keeps existing behaviour for backward compat
    const result = await grantCredits({ teamId, adminUserId, amount, reason });
    return NextResponse.json({
      success: true,
      teamId,
      bucket: "legacy",
      amountGranted: amount,
      newBalance: result.balance,
      ledgerRowId: result.ledgerRowId,
    });
  } catch (err: any) {
    const msg = err?.message ?? "Unknown error";
    if (msg === "Authentication required") return NextResponse.json({ error: msg }, { status: 401 });
    if (msg === "Admin access required") return NextResponse.json({ error: msg }, { status: 403 });
    if (msg.includes("not found")) return NextResponse.json({ error: msg }, { status: 404 });
    console.error("[admin/credits/grant]", err);
    return NextResponse.json({ error: msg }, { status: err?.statusCode || 500 });
  }
}
