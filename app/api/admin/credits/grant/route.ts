import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { grantCredits } from "@/lib/credits";
import { z } from "zod";

const grantSchema = z.object({
  teamId: z.number().int().positive(),
  amount: z.number().int().min(1).max(100000),
  reason: z.string().min(1).max(500).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { userId: adminUserId } = await requireAdmin(request);

    const body = await request.json();
    const parsed = grantSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const { teamId, amount, reason } = parsed.data;
    const result = await grantCredits({ teamId, adminUserId, amount, reason });

    return NextResponse.json({
      success: true,
      teamId,
      amountGranted: amount,
      newBalance: result.balance,
      ledgerRowId: result.ledgerRowId,
    });
  } catch (err: any) {
    const msg = err?.message ?? "Unknown error";
    if (msg === "Authentication required") return NextResponse.json({ error: msg }, { status: 401 });
    if (msg === "Admin access required") return NextResponse.json({ error: msg }, { status: 403 });
    if (msg.includes("not found")) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: err?.statusCode || 500 });
  }
}
