import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, billingEvents } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe";
import { grantCredits } from "@/lib/credits";
import { getPlanByStripePriceId, getTopUpByStripePriceId } from "@/lib/billing/plans";
import type Stripe from "stripe";

export const runtime = "nodejs";

/**
 * Resolve teamId from a Stripe object's metadata or by customer ID lookup.
 * Customer ID is stored in the teams table as soon as checkout.session.completed fires,
 * so this lookup is reliable for all subsequent subscription/invoice events.
 */
async function resolveTeamId(
  obj: { metadata?: Stripe.Metadata | null; customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null }
): Promise<number | null> {
  // 1. Direct metadata (injected when we created checkout session / subscription)
  const meta = obj.metadata;
  if (meta?.teamId) {
    const n = parseInt(meta.teamId, 10);
    if (!isNaN(n)) return n;
  }

  // 2. Fallback via stripeCustomerId stored on teams — immune to subscription-ID race
  const customerId =
    typeof obj.customer === "string"
      ? obj.customer
      : (obj.customer as Stripe.Customer | null)?.id ?? null;

  if (customerId) {
    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.stripeCustomerId, customerId))
      .limit(1);
    if (team) return team.id;
  }

  return null;
}

/**
 * Process the Stripe event.
 * All operations are idempotent:
 *   - grantCredits uses idempotencyKey (unique ledger row per stripe invoice/session ID)
 *   - DB team updates are set-based (no append, safe to rerun)
 * This means Stripe can safely retry failed events.
 */
async function processEvent(event: Stripe.Event, stripe: Stripe): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const teamId = await resolveTeamId(session);
      if (!teamId) return;

      // Persist customer ID immediately so all future events can resolve this team
      const customerId = typeof session.customer === "string" ? session.customer : null;
      if (customerId) {
        await db
          .update(teams)
          .set({ stripeCustomerId: customerId, updatedAt: new Date() })
          .where(eq(teams.id, teamId));
      }

      if (session.mode === "payment" && session.payment_status === "paid") {
        // One-time top-up — fetch line items to identify the price
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
        for (const item of lineItems.data) {
          const priceId = item.price?.id;
          if (!priceId) continue;
          const topUp = getTopUpByStripePriceId(priceId);
          if (!topUp) continue;
          await grantCredits({
            teamId,
            amount: topUp.credits,
            eventType: "topup",
            sourceType: "stripe_topup",
            idempotencyKey: `stripe:topup:${session.id}:${priceId}`,
            reason: `Top-up: ${topUp.label} via Stripe session ${session.id}`,
          });
        }
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const teamId = await resolveTeamId(sub);
      if (!teamId) return;

      const item = sub.items.data[0];
      const priceId = item?.price?.id;
      const plan = priceId ? getPlanByStripePriceId(priceId) : null;

      const billingStatus =
        sub.status === "active"
          ? "active"
          : sub.status === "trialing"
            ? "trialing"
            : sub.status === "past_due"
              ? "past_due"
              : "canceled";

      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

      await db
        .update(teams)
        .set({
          ...(customerId ? { stripeCustomerId: customerId } : {}),
          stripeSubscriptionId: sub.id,
          billingPlan: plan?.id ?? "free",
          billingStatus,
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          updatedAt: new Date(),
        })
        .where(eq(teams.id, teamId));
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const teamId = await resolveTeamId(sub);
      if (!teamId) return;

      await db
        .update(teams)
        .set({
          stripeSubscriptionId: null,
          billingPlan: "free",
          billingStatus: "canceled",
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
        })
        .where(eq(teams.id, teamId));
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      // Grant monthly credits for initial and renewal invoices
      const grantableReasons = ["subscription_create", "subscription_cycle"];
      if (!grantableReasons.includes(invoice.billing_reason ?? "")) return;

      // Resolve via customer ID — no subscription-ID race possible
      const teamId = await resolveTeamId(invoice);
      if (!teamId) return;

      const priceId = invoice.lines.data[0]?.price?.id;
      if (!priceId) return;

      const plan = getPlanByStripePriceId(priceId);
      if (!plan) return;

      await grantCredits({
        teamId,
        amount: plan.monthlyCredits,
        eventType: "subscription_renewal",
        sourceType: "stripe_subscription",
        idempotencyKey: `stripe:invoice:${invoice.id}`,
        reason: `${plan.name} plan credit grant (invoice ${invoice.id}, reason: ${invoice.billing_reason})`,
      });
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const teamId = await resolveTeamId(invoice);
      if (!teamId) return;

      await db
        .update(teams)
        .set({ billingStatus: "past_due", updatedAt: new Date() })
        .where(eq(teams.id, teamId));
      break;
    }

    default:
      break;
  }
}

export async function POST(req: NextRequest) {
  const payload = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  let stripe: Stripe;

  try {
    stripe = await getStripeClient();
    const webhookSecret = await getStripeWebhookSecret();
    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
  } catch (err: any) {
    console.error("[stripe/webhook] signature verification failed:", err.message);
    return NextResponse.json({ error: `Webhook signature error: ${err.message}` }, { status: 400 });
  }

  const eventId = event.id;

  // Idempotency check: if event already processed, skip
  const [existing] = await db
    .select({ id: billingEvents.id })
    .from(billingEvents)
    .where(eq(billingEvents.stripeEventId, eventId))
    .limit(1);

  if (existing) {
    return NextResponse.json({ received: true, skipped: true });
  }

  try {
    // Process first — all operations are idempotent, so Stripe retries on failure are safe
    await processEvent(event, stripe);

    // Mark event as processed only after successful handling
    // ON CONFLICT DO NOTHING handles the unlikely concurrent duplicate delivery
    await db
      .insert(billingEvents)
      .values({
        stripeEventId: eventId,
        eventType: event.type,
        teamId: null,
        payload: event as any,
      })
      .onConflictDoNothing();
  } catch (err: any) {
    // Do NOT mark event as processed — let Stripe retry
    console.error("[stripe/webhook] handler error:", err);
    return NextResponse.json({ error: "Webhook processing error — will retry" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
