import { NextResponse } from "next/server";

/**
 * DEPRECATED — this endpoint has been superseded by /api/billing/webhook.
 *
 * Configure your Stripe webhook dashboard to point ONLY to /api/billing/webhook.
 * This stub returns 410 Gone so any misconfigured Stripe delivery is immediately
 * visible in the Stripe dashboard event log rather than silently writing to the
 * legacy credit balance column.
 */
export async function POST() {
  console.error(
    "[stripe/webhook] DEPRECATED endpoint received a delivery. " +
      "Update your Stripe webhook URL to /api/billing/webhook."
  );
  return NextResponse.json(
    {
      error: "This webhook endpoint is deprecated.",
      action: "Update your Stripe webhook URL in the Stripe dashboard to /api/billing/webhook.",
    },
    { status: 410 }
  );
}
