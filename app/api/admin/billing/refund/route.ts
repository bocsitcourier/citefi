import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, teamMembers, teams, adminActionLogs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";
import { getStripeClient } from "@/lib/stripe";
import { deliverEmail } from "@/lib/email";
import { enqueueStripeCreditReversal } from "@/lib/stripe-credit-reconciliation";
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
      .select({
        userEmail: users.email,
        stripeCustomerId: teams.stripeCustomerId,
        teamId: teams.id,
      })
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
      { idempotencyKey: `refund-${chargeId}-${adminUserId}-${amount}` }
    );

    // Stripe success and credit reconciliation share one durable idempotent
    // path with webhooks. A DB failure returns 500 so the same Stripe
    // idempotency key can safely retry instead of silently leaving credits.
    await enqueueStripeCreditReversal({
      providerObjectId: refund.id,
      objectType: "refund",
      teamId: membership.teamId,
      chargeId,
      refundId: refund.id,
      invoiceId: typeof (charge as any).invoice === "string" ? (charge as any).invoice : (charge as any).invoice?.id,
      paymentIntentId: typeof charge.payment_intent === "string" ? charge.payment_intent : undefined,
      // Fetching the charge above gives the pre-refund total. Stripe returns
      // the authoritative cumulative amount on the refund response only in
      // some API versions, so retrieve it after creation for exact partitions.
      currencyAmount: (await stripe.charges.retrieve(chargeId)).amount_refunded,
      originalChargeAmount: charge.amount,
      payload: refund,
      adminUserId,
    });

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

    const escHtml = (s: string) =>
      String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const fmtCurrency = (cents: number, currency = "usd") =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

    deliverEmail({
      to: membership.userEmail,
      subject: "Citefi refund issued",
      text: `A refund of ${fmtCurrency(refund.amount ?? amount, refund.currency)} has been issued to your account. It typically appears on your statement within 5-10 business days.${reason ? `\n\nReason: ${reason}` : ""}\n\nRefund ID: ${refund.id}`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto"><h2>Refund Issued</h2><p>A refund of <strong>${fmtCurrency(refund.amount ?? amount, refund.currency)}</strong> has been issued to your account.</p><p style="color:#666">It typically appears on your statement within 5-10 business days.</p>${reason ? `<p><strong>Reason:</strong> ${escHtml(reason)}</p>` : ""}<p style="color:#999;font-size:0.85em">Refund ID: ${refund.id}</p></div>`,
    }).catch(() => {});

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
