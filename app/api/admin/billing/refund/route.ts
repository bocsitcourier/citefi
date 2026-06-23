import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, teamMembers, teams, adminActionLogs } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";
import { getStripeClient } from "@/lib/stripe";
import { z } from "zod";

export async function GET(req: NextRequest) {
  try {
    const adminUserId = await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const userIdParam = searchParams.get("userId");
    if (!userIdParam) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    const userId = parseInt(userIdParam);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }

    const [membership] = await db
      .select({
        stripeCustomerId: teams.stripeCustomerId,
        teamName: teams.name,
        userEmail: users.email,
      })
      .from(users)
      .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(users.id, userId))
      .limit(1);

    if (!membership?.stripeCustomerId) {
      return NextResponse.json({ error: "No Stripe customer found for this user" }, { status: 404 });
    }

    const stripe = await getStripeClient();
    const charges = await stripe.charges.list({
      customer: membership.stripeCustomerId,
      limit: 10,
    });

    const chargeList = charges.data.map((c) => ({
      id: c.id,
      amount: c.amount,
      amountRefunded: c.amount_refunded,
      currency: c.currency,
      description: c.description ?? "Charge",
      created: new Date(c.created * 1000).toISOString(),
      refunded: c.refunded,
      maxRefundable: c.amount - c.amount_refunded,
    }));

    return NextResponse.json({
      userId,
      userEmail: membership.userEmail,
      teamName: membership.teamName,
      customerId: `cus_...${membership.stripeCustomerId.slice(-4)}`,
      charges: chargeList,
    });
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/billing/refund GET]", err);
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}

const refundSchema = z.object({
  userId: z.number().int().positive(),
  chargeId: z.string().min(1),
  amount: z.number().int().positive(),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const adminUserId = await requireAdmin(req);

    const body = await req.json();
    const parsed = refundSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { userId, chargeId, amount, reason } = parsed.data;

    const [membership] = await db
      .select({ userEmail: users.email, stripeCustomerId: teams.stripeCustomerId })
      .from(users)
      .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(users.id, userId))
      .limit(1);

    if (!membership?.stripeCustomerId) {
      return NextResponse.json({ error: "No Stripe customer found" }, { status: 404 });
    }

    const stripe = await getStripeClient();

    const charge = await stripe.charges.retrieve(chargeId);
    if (charge.customer !== membership.stripeCustomerId) {
      return NextResponse.json({ error: "Charge does not belong to this customer" }, { status: 400 });
    }
    const maxRefundable = charge.amount - charge.amount_refunded;
    if (amount > maxRefundable) {
      return NextResponse.json({ error: `Refund amount exceeds maximum refundable (${maxRefundable})` }, { status: 400 });
    }

    const refund = await stripe.refunds.create(
      {
        charge: chargeId,
        amount,
        reason: (reason?.toLowerCase().includes("duplicate")
          ? "duplicate"
          : reason?.toLowerCase().includes("fraud")
          ? "fraudulent"
          : "requested_by_customer") as any,
        metadata: { adminUserId: String(adminUserId), reason: reason ?? "" },
      },
      { idempotencyKey: `refund-${chargeId}-${adminUserId}-${Date.now()}` }
    );

    await db.insert(adminActionLogs).values({
      userId: adminUserId,
      action: "stripe_refund_issued",
      targetType: "charge",
      details: JSON.stringify({
        chargeId,
        refundId: refund.id,
        amount,
        reason,
        targetUserId: userId,
        targetUserEmail: membership.userEmail,
      }),
    });

    return NextResponse.json({
      success: true,
      refundId: refund.id,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status,
    });
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/billing/refund POST]", err);
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}
