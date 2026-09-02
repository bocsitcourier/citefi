import { NextRequest, NextResponse } from "next/server";
import { systemDb as db } from "@/lib/db";
import { teams, billingEvents } from "@/shared/schema";
import { eq, isNull } from "drizzle-orm";
import { grantAllowance, grantPurchased } from "@/lib/billing";
import { getPlanByStripePriceId, getTopUpByStripePriceId } from "@/lib/billing/plans";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe";
import type Stripe from "stripe";
import { enterSystemContext } from "@/lib/tenant-context";
import { enqueueStripeCreditReversal, shouldReverseStripeDispute } from "@/lib/stripe-credit-reconciliation";

export const dynamic = "force-dynamic";

function subscriptionPeriod(subscription: Stripe.Subscription): { start: number; end: number } {
  const legacy = subscription as Stripe.Subscription & {
    current_period_start?: number;
    current_period_end?: number;
  };
  const item = subscription.items.data[0] as (Stripe.SubscriptionItem & {
    current_period_start?: number;
    current_period_end?: number;
  }) | undefined;
  const start = legacy.current_period_start ?? item?.current_period_start;
  const end = legacy.current_period_end ?? item?.current_period_end;
  if (!start || !end) throw new Error(`Stripe subscription ${subscription.id} has no billing period`);
  return { start, end };
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const value = (invoice as any).subscription
    ?? (invoice as any).parent?.subscription_details?.subscription;
  return typeof value === "string" ? value : value?.id ?? null;
}

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

/**
 * Grant a one-time credit pack only after Stripe has confirmed payment.
 * The ledger idempotency key is anchored to the Checkout Session rather than
 * the webhook event, so checkout.session.completed and delayed-payment events
 * cannot both credit the same purchase.
 */
async function grantTopUpForCheckoutSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  teamId: number
): Promise<void> {
  if (session.mode !== "payment") return;

  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    console.log(
      `[billing/webhook] Top-up session ${session.id} is ${session.payment_status}; awaiting payment confirmation`
    );
    return;
  }

  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 5,
    expand: ["data.price"],
  });
  const price = lineItems.data[0]?.price;
  const topUp = price ? getTopUpByStripePriceId(price.id) : null;

  // Price lookup is deliberately allow-listed through TOP_UPS. Do not credit
  // an arbitrary one-time Stripe product if a price is misconfigured.
  if (!topUp) {
    console.error(`[billing/webhook] Unrecognised top-up price for session ${session.id}`);
    return;
  }

  await grantPurchased({
    teamId,
    amount: topUp.credits,
    idempotencyKey: `topup-${session.id}`,
    reason: `Top-up: ${topUp.label} ($${topUp.priceUsd})`,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined,
  });
  console.log(`[billing/webhook] Granted ${topUp.credits} purchased credits to team ${teamId}`);
}

export async function POST(req: NextRequest) {
  enterSystemContext("verified Stripe billing webhook");
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
          const period = subscriptionPeriod(sub);

          if (!plan) {
            // Fail closed: unknown Stripe price — preserve existing plan, do not downgrade.
            // Log for manual review and leave team in current billing state.
            console.error(
              `[billing/webhook] checkout.session.completed: unrecognised priceId="${priceId}" ` +
              `for session ${session.id} team ${teamId}. Preserving existing plan — manual review required.`
            );
            await db.update(teams).set({
              stripeSubscriptionId: subId,
              stripePriceId: priceId ?? null,
              billingStatus: sub.status,
              currentPeriodEnd: new Date(period.end * 1000),
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              updatedAt: new Date(),
            }).where(eq(teams.id, teamId));
            break;
          }

          await db.update(teams).set({
            stripeSubscriptionId: subId,
            stripePriceId: priceId ?? null,
            billingPlan: plan.id,
            billingStatus: sub.status,
            currentPeriodEnd: new Date(period.end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            updatedAt: new Date(),
          }).where(eq(teams.id, teamId));

          await grantAllowance({
            teamId,
            amount: plan.monthlyCredits,
            periodStart: new Date(period.start * 1000),
            periodEnd: new Date(period.end * 1000),
            idempotencyKey: `checkout-grant-${session.id}`,
            reason: `Plan activated: ${plan.name} (${plan.monthlyCredits} credits)`,
          });
        } else if (session.mode === "payment") {
          await grantTopUpForCheckoutSession(stripe, session, teamId);
        }
        break;
      }

      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        teamId = parseTeamIdFromMetadata(session.metadata);

        if (!teamId) {
          console.warn(`[billing/webhook] ${event.type}: no teamId in metadata for session ${session.id}`);
          break;
        }

        await grantTopUpForCheckoutSession(stripe, session, teamId);
        break;
      }

      case "invoice.payment_succeeded":
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const subId = invoiceSubscriptionId(invoice);

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
        const period = subscriptionPeriod(sub);

        if (plan) {
          const periodStart = new Date((invoice.period_start ?? period.start) * 1000);
          const periodEnd = new Date((invoice.period_end ?? period.end) * 1000);

          await grantAllowance({
            teamId,
            amount: plan.monthlyCredits,
            periodStart,
            periodEnd,
            idempotencyKey: `invoice-grant-${invoice.id}`,
            stripeInvoiceId: invoice.id,
            reason: `Billing cycle renewal: ${plan.name} (${plan.monthlyCredits} credits)`,
          });

          await db.update(teams).set({
            billingPlan: plan.id,
            billingStatus: sub.status,
            stripePriceId: priceId ?? null,
            currentPeriodEnd: new Date(period.end * 1000),
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
        const subId = invoiceSubscriptionId(invoice);
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
        const period = subscriptionPeriod(sub);
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

        if (!plan) {
          // Fail closed: unknown price on subscription update — preserve existing billingPlan.
          console.error(
            `[billing/webhook] customer.subscription.updated: unrecognised priceId="${priceId}" ` +
            `for subscription ${sub.id} team ${teamId}. Preserving existing plan — manual review required.`
          );
          await db.update(teams).set({
            billingStatus: sub.status,
            stripePriceId: priceId ?? null,
            stripeSubscriptionId: sub.id,
            currentPeriodEnd: new Date(period.end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            updatedAt: new Date(),
          }).where(eq(teams.id, teamId));
        } else {
          await db.update(teams).set({
            billingStatus: sub.status,
            billingPlan: plan.id,
            stripePriceId: priceId ?? null,
            stripeSubscriptionId: sub.id,
            currentPeriodEnd: new Date(period.end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            updatedAt: new Date(),
          }).where(eq(teams.id, teamId));
        }

        console.log(`[billing/webhook] Team ${teamId} subscription updated: plan=${plan?.id ?? "preserved"} status=${sub.status}`);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const period = subscriptionPeriod(sub);
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
          currentPeriodEnd: new Date(period.end * 1000),
          updatedAt: new Date(),
        }).where(eq(teams.id, teamId));

        console.log(`[billing/webhook] Team ${teamId} subscription cancelled (period ends ${new Date(period.end * 1000).toISOString()})`);
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

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        teamId = await resolveTeamId(stripe, typeof charge.customer === "string" ? charge.customer : null);
        if (!teamId) throw new Error(`No team found for refunded charge ${charge.id}`);
        const invoiceId = typeof (charge as any).invoice === "string" ? (charge as any).invoice : (charge as any).invoice?.id;
        for (const refund of charge.refunds?.data ?? []) {
          if (refund.status && refund.status !== "succeeded") continue;
          await enqueueStripeCreditReversal({
            providerObjectId: refund.id, objectType: "refund", teamId, chargeId: charge.id,
            refundId: refund.id, invoiceId: invoiceId ?? undefined,
            paymentIntentId: typeof charge.payment_intent === "string" ? charge.payment_intent : undefined,
            currencyAmount: charge.amount_refunded, originalChargeAmount: charge.amount, payload: refund,
          });
        }
        break;
      }

      case "refund.updated": {
        const refund = event.data.object as Stripe.Refund;
        if (refund.status && refund.status !== "succeeded") break;
        const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
        if (!chargeId) throw new Error(`Refund ${refund.id} has no charge`);
        const charge = await stripe.charges.retrieve(chargeId);
        teamId = await resolveTeamId(stripe, typeof charge.customer === "string" ? charge.customer : null);
        if (!teamId) throw new Error(`No team found for refund ${refund.id}`);
        await enqueueStripeCreditReversal({
          providerObjectId: refund.id, objectType: "refund", teamId, chargeId,
          refundId: refund.id,
          invoiceId: typeof (charge as any).invoice === "string" ? (charge as any).invoice : (charge as any).invoice?.id,
          paymentIntentId: typeof charge.payment_intent === "string" ? charge.payment_intent : undefined,
          currencyAmount: charge.amount_refunded, originalChargeAmount: charge.amount, payload: refund,
        });
        break;
      }

      case "charge.dispute.created":
      case "charge.dispute.closed": {
        const dispute = event.data.object as Stripe.Dispute;
        // Opening a dispute is not a settled loss. Do not even enqueue a
        // reconciliation row here: it may subsequently be won or withdrawn.
        if (event.type === "charge.dispute.created") break;
        const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
        const charge = await stripe.charges.retrieve(chargeId);
        teamId = await resolveTeamId(stripe, typeof charge.customer === "string" ? charge.customer : null);
        if (!teamId) throw new Error(`No team found for dispute ${dispute.id}`);
        // A lost dispute is equivalent to a full refund. Won/withdrawn closures
        // remain in billing_events but do not revoke entitlement.
        if (shouldReverseStripeDispute(dispute.status)) {
          await enqueueStripeCreditReversal({
            providerObjectId: dispute.id, objectType: "dispute", teamId, chargeId,
            disputeId: dispute.id,
            invoiceId: typeof (charge as any).invoice === "string" ? (charge as any).invoice : (charge as any).invoice?.id,
            paymentIntentId: typeof charge.payment_intent === "string" ? charge.payment_intent : undefined,
            currencyAmount: dispute.amount, originalChargeAmount: charge.amount, payload: dispute,
          });
        }
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
