import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teams, users } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { getStripeClient } from "@/lib/stripe";
import { BILLING_PLANS, TOP_UPS } from "@/lib/billing/plans";
import { z } from "zod";

const schema = z.union([
  z.object({ kind: z.literal("subscription"), planId: z.string().min(1) }),
  z.object({ kind: z.literal("topup"), topUpId: z.string().min(1) }),
]);

function getStripePriceId(kind: "subscription" | "topup", id: string): string | null {
  if (kind === "subscription") {
    const plan = BILLING_PLANS[id as keyof typeof BILLING_PLANS];
    if (!plan || !plan.stripePriceEnvKey) return null;
    return process.env[plan.stripePriceEnvKey] ?? null;
  } else {
    const topUp = TOP_UPS.find((t) => t.id === id);
    if (!topUp || !topUp.stripePriceEnvKey) return null;
    return process.env[topUp.stripePriceEnvKey] ?? null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { teamId, userId } = await requireTeamAdmin(req);
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const data = parsed.data;
    const priceId = getStripePriceId(
      data.kind,
      data.kind === "subscription" ? data.planId : data.topUpId
    );

    if (!priceId) {
      return NextResponse.json(
        {
          error: "Stripe price not configured for this plan. Run the seed script first.",
          hint: "npx tsx scripts/seed-stripe-products.ts",
        },
        { status: 503 }
      );
    }

    const [team] = await db
      .select({ stripeCustomerId: teams.stripeCustomerId, stripeSubscriptionId: teams.stripeSubscriptionId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);

    const [user] = await db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const stripe = await getStripeClient();

    // Find or create Stripe customer for this team
    let customerId = team?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user?.email,
        name: user?.fullName ?? undefined,
        metadata: { teamId: String(teamId), userId: String(userId) },
      });
      customerId = customer.id;
      await db.update(teams).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(teams.id, teamId));
    }

    // Restrict redirect URLs to the configured application origin (NEXTAUTH_URL)
    // Never use the client-provided origin header — prevents open redirect attacks
    const appOrigin = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
    if (!appOrigin) {
      console.error("[billing/checkout] NEXTAUTH_URL not configured — cannot build redirect URLs");
      return NextResponse.json({ error: "Server misconfiguration: NEXTAUTH_URL not set" }, { status: 503 });
    }
    const successUrl = `${appOrigin}/settings/billing?success=1`;
    const cancelUrl = `${appOrigin}/settings/billing?canceled=1`;

    // If team already has an active subscription → open billing portal to upgrade/switch
    if (data.kind === "subscription" && team?.stripeSubscriptionId) {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${appOrigin}/settings/billing`,
      });
      return NextResponse.json({ url: portal.url, portal: true });
    }

    const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: data.kind === "subscription" ? "subscription" : "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { teamId: String(teamId), userId: String(userId), kind: data.kind },
      ...(data.kind === "subscription" && {
        subscription_data: { metadata: { teamId: String(teamId) } },
      }),
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[billing/checkout]", err);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
