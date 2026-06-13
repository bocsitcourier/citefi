/**
 * Seed Stripe products and prices for ApexContent Engine billing plans.
 *
 * Run with: npx tsx scripts/seed-stripe-products.ts
 *
 * After running, copy the printed price IDs to your .env.local:
 *   STRIPE_PRICE_STARTER=price_xxx
 *   STRIPE_PRICE_PRO=price_xxx
 *   STRIPE_PRICE_AGENCY=price_xxx
 *   STRIPE_PRICE_TOPUP_100=price_xxx
 *   STRIPE_PRICE_TOPUP_500=price_xxx
 *   STRIPE_PRICE_TOPUP_1000=price_xxx
 */

import "dotenv/config";

const PLANS = [
  {
    name: "Starter Plan",
    description: "500 credits/month for growing content teams",
    envKey: "STRIPE_PRICE_STARTER",
    priceUsd: 29,
    metadata: { plan: "starter", credits: "500", type: "subscription" },
  },
  {
    name: "Pro Plan",
    description: "2,000 credits/month for professional content operations",
    envKey: "STRIPE_PRICE_PRO",
    priceUsd: 79,
    metadata: { plan: "pro", credits: "2000", type: "subscription" },
  },
  {
    name: "Agency Plan",
    description: "10,000 credits/month for full-service agencies",
    envKey: "STRIPE_PRICE_AGENCY",
    priceUsd: 199,
    metadata: { plan: "agency", credits: "10000", type: "subscription" },
  },
];

const TOP_UPS = [
  {
    name: "100 Credits Top-Up",
    description: "One-time purchase of 100 credits",
    envKey: "STRIPE_PRICE_TOPUP_100",
    priceUsd: 9,
    metadata: { type: "topup", credits: "100" },
  },
  {
    name: "500 Credits Top-Up",
    description: "One-time purchase of 500 credits",
    envKey: "STRIPE_PRICE_TOPUP_500",
    priceUsd: 39,
    metadata: { type: "topup", credits: "500" },
  },
  {
    name: "1,000 Credits Top-Up",
    description: "One-time purchase of 1,000 credits",
    envKey: "STRIPE_PRICE_TOPUP_1000",
    priceUsd: 69,
    metadata: { type: "topup", credits: "1000" },
  },
];

async function getStripeKey(): Promise<string> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (key) return key;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error("Set STRIPE_SECRET_KEY or connect Stripe via Replit integrations");
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken } }
  );
  const data = await resp.json();
  const sk = data.items?.[0]?.settings?.secret_key;
  if (!sk) throw new Error("Stripe integration not connected");
  return sk;
}

async function main() {
  const { default: Stripe } = await import("stripe");
  const secretKey = await getStripeKey();
  const stripe = new Stripe(secretKey, { apiVersion: "2025-05-28.basil" });

  console.log("\n=== Seeding Stripe subscription plans ===\n");
  const envLines: string[] = [];

  for (const plan of PLANS) {
    const existing = await stripe.products.search({
      query: `name:'${plan.name}' AND active:'true'`,
    });

    let productId: string;
    if (existing.data.length > 0) {
      productId = existing.data[0].id;
      console.log(`[SKIP] ${plan.name} already exists: ${productId}`);
    } else {
      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        metadata: plan.metadata,
      });
      productId = product.id;
      console.log(`[CREATE] ${plan.name}: ${productId}`);
    }

    // Check for existing monthly price
    const prices = await stripe.prices.list({ product: productId, active: true, limit: 10 });
    const monthlyPrice = prices.data.find((p) => p.recurring?.interval === "month");

    let priceId: string;
    if (monthlyPrice) {
      priceId = monthlyPrice.id;
      console.log(`[SKIP] Monthly price already exists: ${priceId}`);
    } else {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: plan.priceUsd * 100,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: plan.metadata,
      });
      priceId = price.id;
      console.log(`[CREATE] Monthly price $${plan.priceUsd}/mo: ${priceId}`);
    }

    envLines.push(`${plan.envKey}=${priceId}`);
  }

  console.log("\n=== Seeding credit top-ups ===\n");

  for (const topUp of TOP_UPS) {
    const existing = await stripe.products.search({
      query: `name:'${topUp.name}' AND active:'true'`,
    });

    let productId: string;
    if (existing.data.length > 0) {
      productId = existing.data[0].id;
      console.log(`[SKIP] ${topUp.name} already exists: ${productId}`);
    } else {
      const product = await stripe.products.create({
        name: topUp.name,
        description: topUp.description,
        metadata: topUp.metadata,
      });
      productId = product.id;
      console.log(`[CREATE] ${topUp.name}: ${productId}`);
    }

    const prices = await stripe.prices.list({ product: productId, active: true, limit: 10 });
    const oneTimePrice = prices.data.find((p) => !p.recurring);

    let priceId: string;
    if (oneTimePrice) {
      priceId = oneTimePrice.id;
      console.log(`[SKIP] One-time price already exists: ${priceId}`);
    } else {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: topUp.priceUsd * 100,
        currency: "usd",
        metadata: topUp.metadata,
      });
      priceId = price.id;
      console.log(`[CREATE] One-time price $${topUp.priceUsd}: ${priceId}`);
    }

    envLines.push(`${topUp.envKey}=${priceId}`);
  }

  console.log("\n=== Add these to your .env.local / environment secrets ===\n");
  for (const line of envLines) {
    console.log(line);
  }
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
