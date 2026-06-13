import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teams } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { getStripeClient } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const { teamId } = await requireTeamAdmin(req);

    const [team] = await db
      .select({ stripeCustomerId: teams.stripeCustomerId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);

    if (!team?.stripeCustomerId) {
      return NextResponse.json(
        { error: "No billing account found. Subscribe to a plan first." },
        { status: 404 }
      );
    }

    const stripe = await getStripeClient();

    // Use configured NEXTAUTH_URL — never the client-provided origin header
    const appOrigin = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
    if (!appOrigin) {
      return NextResponse.json({ error: "Server misconfiguration: NEXTAUTH_URL not set" }, { status: 503 });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: team.stripeCustomerId,
      return_url: `${appOrigin}/settings/billing`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[billing/portal]", err);
    return NextResponse.json({ error: "Failed to create portal session" }, { status: 500 });
  }
}
