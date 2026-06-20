import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, billingEvents } from "@/shared/schema";
import { eq, isNull } from "drizzle-orm";
import { grantAllowance, grantPurchased } from "@/lib/billing";
import { getPlanByStripePriceId, getTopUpByStripePriceId } from "@/lib/billing/plans";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";

async function findTeamByCustomerId(customerId: string): Promise<number | null> {
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.stripeCustomerId, customerId))
    .limit(1);
  return team?.id ?? null;
}

async function findTeamBySubscriptionId(subscriptionId: string): Promise<number | null> {
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.stripeSubscriptionId, subscriptionId))
    .limit(1);
  return team?.id ?? null;
}

function parseTeamIdFromMetadata(metadata: Stripe.Metadata | null | undefined): number | null {
  const raw = metadata?.teamId;
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? null : parsed;
}

async function resolveTeamId(
  stripe: Stripe,
  customerId?: string | null,
  subscriptionId?: string | null,
  metadata?: Stripe.Metadata | null
): Promise<number | null> {
  if (customerId) {
    const id = await findTeamByCustomerId(customerId);
    if (id) return id;
  }
  if (subscriptionId) {
    const id = await findTeamBySubscriptionId(subscriptionId);
    if (id) return id;
  }
  return parseTeamIdFromMetadata(metadata);
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  let stripe: Stripe;

  try {
    stripe = await getStripeClient();
    const webhookSecret = await getStripeWebhookSecret();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error("[billing/webhook] Signature verification failed:", err.message);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${err.message}` },
      { status: 400 }
    );
  }

  const [existing] = await db
    .select({ id: billingEvents.id })
    .from(billingEvents)
    .where(eq(billingEvents.stripeEventId, event.id))
    .limit(1);

  if (existing) {
    console.log(`[billing/webhook] Event ${event.id} already processed — skipping (idempotent)`);
    return NextResponse.json({ received: true, skipped: true });
  }

  let teamId: number | null = null;

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        teamId = parseTeamIdFromMetadata(session.metadata);

        if (!teamId) {
          console.warn(`[billing/webhook] checkout.session.completed: no teamId in metadata for session ${session.id}`);
          break;
        }

        if (session.mode === "subscription") {
          const subId = session.subscription as string;
          const sub = await stripe.subscriptions.retrieve(subId, {
            expand: ["items.data.price"],
          });
          const priceId = sub.items.data[0]?.price?.id;
          const plan = priceId ? getPlanByStripePriceId(priceId) : null;

          await db.update(teams).set({
            stripeSubscriptionId: subId,
            stripePriceId: priceId ?? null,
            billingPlan: plan?.id ?? "free",
            billingStatus: sub.status,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            updatedAt: new Date(),
          }).where(eq(teams.id, teamId));

          if (plan) {
            await grantAllowance({
              teamId,
              amount: plan.monthlyCredits,
              periodStart: new Date(sub.current_period_start * 1000),
              periodEnd: new Date(sub.current_period_end * 1000),
              idempotencyKey: `checkout-grant-${session.id}`,
              reason: `Plan activated: ${plan.name} (${plan.monthlyCredits} credits)`,
            });
          }
        } else if (session.mode === "payment") {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
            limit: 5,
            expand: ["data.price"],
          });
          const price = lineItems.data[0]?.price;
          const topUp = price ? getTopUpByStripePriceId(price.id) : null;

          if (topUp) {
            await grantPurchased({
              teamId,
              amount: topUp.credits,
              idempotencyKey: `topup-${session.id}`,
              reason: `Top-up: ${topUp.label} ($${topUp.priceUsd})`,
            });
            console.log(`[billing/webhook] Granted ${topUp.credits} purchased credits to team ${teamId}`);
          } else {
            console.warn(`[billing/webhook] Unrecognised top-up price for session ${session.id}`);
          }
        }
        break;
      }

      case "invoice.payment_succeeded":
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const subId = invoice.subscription as string | null;

        teamId = await resolveTeamId(stripe, customerId, subId ?? undefined);
        if (!teamId) {
          console.warn(`[billing/webhook] ${event.type}: no team found for customer ${customerId}`);
          break;
        }

        if (!subId) break;

        const sub = await stripe.subscriptions.retrieve(subId, {
          expand: ["items.data.price"],
        });
        const priceId = sub.items.data[0]?.price?.id;
        const plan = priceId ? getPlanByStripePriceId(priceId) : null;

        if (plan) {
          const periodStart = new Date((invoice.period_start ?? sub.current_period_start) * 1000);
          const periodEnd = new Date((invoice.period_end ?? sub.current_period_end) * 1000);

          await grantAllowance({
            teamId,
            amount: plan.monthlyCredits,
            periodStart,
            periodEnd,
            idempotencyKey: `invoice-grant-${invoice.id}`,
            reason: `Billing cycle renewal: ${plan.name} (${plan.monthlyCredits} credits)`,
          });

          await db.update(teams).set({
            billingPlan: plan.id,
            billingStatus: sub.status,
            stripePriceId: priceId ?? null,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            updatedAt: new Date(),
          }).where(eq(teams.id, teamId));

          console.log(`[billing/webhook] ${event.type}: renewed ${plan.monthlyCredits} allowance for team ${teamId}`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const subId = invoice.subscription as string | null;
        teamId = await resolveTeamId(stripe, customerId, subId ?? undefined);

        if (!teamId) {
          console.warn(`[billing/webhook] invoice.payment_failed: no team for customer ${customerId}`);
          break;
        }

        await db.update(teams).set({
          billingStatus: "past_due",
          updatedAt: new Date(),
        }).where(eq(teams.id, teamId));

        console.log(`[billing/webhook] Team ${teamId} marked past_due`);
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        teamId = await resolveTeamId(
          stripe,
          sub.customer as string,
          sub.id,
          sub.metadata
        );

        if (!teamId) {
          console.warn(`[billing/webhook] customer.subscription.updated: no team for subscription ${sub.id}`);
          break;
        }

        const priceId = sub.items.data[0]?.price?.id;
        const plan = priceId ? getPlanByStripePriceId(priceId) : null;

        await db.update(teams).set({
          billingStatus: sub.status,
          billingPlan: plan?.id ?? "free",
          stripePriceId: priceId ?? null,
          stripeSubscriptionId: sub.id,
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          updatedAt: new Date(),
        }).where(eq(teams.id, teamId));

        console.log(`[billing/webhook] Team ${teamId} subscription updated: plan=${plan?.id ?? "unknown"} status=${sub.status}`);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        teamId = await resolveTeamId(
          stripe,
          sub.customer as string,
          sub.id,
          sub.metadata
        );

        if (!teamId) {
          console.warn(`[billing/webhook] customer.subscription.deleted: no team for subscription ${sub.id}`);
          break;
        }

        await db.update(teams).set({
          billingStatus: "cancelled",
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          updatedAt: new Date(),
        }).where(eq(teams.id, teamId));

        console.log(`[billing/webhook] Team ${teamId} subscription cancelled (period ends ${new Date(sub.current_period_end * 1000).toISOString()})`);
        break;
      }

      case "customer.subscription.trial_will_end": {
        const sub = event.data.object as Stripe.Subscription;
        teamId = await resolveTeamId(
          stripe,
          sub.customer as string,
          sub.id,
          sub.metadata
        );
        console.log(`[billing/webhook] Trial ending in 3 days — team ${teamId ?? "(not found)"}, subscription ${sub.id}`);
        break;
      }

      default:
        console.log(`[billing/webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err: any) {
    console.error(`[billing/webhook] Error processing event ${event.id} (${event.type}):`, err);
    return NextResponse.json(
      { error: "Internal error processing webhook", eventId: event.id },
      { status: 500 }
    );
  }

  try {
    await db.insert(billingEvents).values({
      stripeEventId: event.id,
      eventType: event.type,
      teamId: teamId ?? null,
      processedAt: new Date(),
      payload: event.data.object as any,
    });
  } catch (insertErr: any) {
    if (!insertErr.message?.includes("duplicate") && !insertErr.message?.includes("unique")) {
      console.error(`[billing/webhook] Failed to record event ${event.id}:`, insertErr);
    }
  }

  return NextResponse.json({ received: true });
}
