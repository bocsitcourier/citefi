/**
 * Seed Stripe products and prices for ApexContent Engine billing plans.
 *
 * Run with: npx tsx scripts/seed-stripe-products.ts
 *
 * After running, copy the printed env lines to your .env.local (or add as Replit secrets):
 *   STRIPE_PRICE_STARTER=price_xxx
 *   STRIPE_PRICE_STARTER_ANNUAL=price_xxx
 *   STRIPE_PRICE_GROWTH=price_xxx
 *   STRIPE_PRICE_GROWTH_ANNUAL=price_xxx
 *   STRIPE_PRICE_TOPUP_20=price_xxx
 *   STRIPE_PRICE_TOPUP_50=price_xxx
 *   STRIPE_PRICE_TOPUP_100=price_xxx
 *   STRIPE_PRICE_TOPUP_250=price_xxx
 *   STRIPE_PRICE_TOPUP_500=price_xxx
 */

import "dotenv/config";

const PLANS = [
  {
    name: "Starter Plan",
    description: "50 credits/month for growing content teams",
    monthlyEnvKey: "STRIPE_PRICE_STARTER",
    annualEnvKey: "STRIPE_PRICE_STARTER_ANNUAL",
    monthlyPriceUsd: 29,
    annualPriceUsd: 290,
    metadata: { plan: "starter", credits: "50", type: "subscription" },
  },
  {
    name: "Growth Plan",
    description: "200 credits/month for professional content operations",
    monthlyEnvKey: "STRIPE_PRICE_GROWTH",
    annualEnvKey: "STRIPE_PRICE_GROWTH_ANNUAL",
    monthlyPriceUsd: 89,
    annualPriceUsd: 890,
    metadata: { plan: "growth", credits: "200", type: "subscription" },
  },
];

const TOP_UPS = [
  { name: "20 Credits — Starter Pack",   envKey: "STRIPE_PRICE_TOPUP_20",  priceUsd: 12,  credits: 20  },
  { name: "50 Credits — Small Pack",     envKey: "STRIPE_PRICE_TOPUP_50",  priceUsd: 25,  credits: 50  },
  { name: "100 Credits — Medium Pack",   envKey: "STRIPE_PRICE_TOPUP_100", priceUsd: 45,  credits: 100 },
  { name: "250 Credits — Large Pack",    envKey: "STRIPE_PRICE_TOPUP_250", priceUsd: 100, credits: 250 },
  { name: "500 Credits — Bulk Pack",     envKey: "STRIPE_PRICE_TOPUP_500", priceUsd: 180, credits: 500 },
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
      console.log(`[SKIP] ${plan.name} product already exists: ${productId}`);
    } else {
      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        metadata: plan.metadata,
      });
      productId = product.id;
      console.log(`[CREATE] ${plan.name}: ${productId}`);
    }

    const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });

    // Monthly price
    const existingMonthly = prices.data.find(
      (p) => p.recurring?.interval === "month" && p.recurring?.interval_count === 1
    );
    if (existingMonthly) {
      console.log(`[SKIP] Monthly price already exists: ${existingMonthly.id}`);
      envLines.push(`${plan.monthlyEnvKey}=${existingMonthly.id}`);
    } else {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: plan.monthlyPriceUsd * 100,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { ...plan.metadata, billing: "monthly" },
      });
      console.log(`[CREATE] Monthly $${plan.monthlyPriceUsd}/mo: ${price.id}`);
      envLines.push(`${plan.monthlyEnvKey}=${price.id}`);
    }

    // Annual price (10 months for 12)
    const existingAnnual = prices.data.find(
      (p) => p.recurring?.interval === "year" && p.recurring?.interval_count === 1
    );
    if (existingAnnual) {
      console.log(`[SKIP] Annual price already exists: ${existingAnnual.id}`);
      envLines.push(`${plan.annualEnvKey}=${existingAnnual.id}`);
    } else {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: plan.annualPriceUsd * 100,
        currency: "usd",
        recurring: { interval: "year" },
        metadata: { ...plan.metadata, billing: "annual" },
      });
      console.log(`[CREATE] Annual $${plan.annualPriceUsd}/yr: ${price.id}`);
      envLines.push(`${plan.annualEnvKey}=${price.id}`);
    }
  }

  console.log("\n=== Seeding credit top-ups ===\n");

  for (const topUp of TOP_UPS) {
    const existing = await stripe.products.search({
      query: `name:'${topUp.name}' AND active:'true'`,
    });

    let productId: string;
    if (existing.data.length > 0) {
      productId = existing.data[0].id;
      console.log(`[SKIP] ${topUp.name} product already exists: ${productId}`);
    } else {
      const product = await stripe.products.create({
        name: topUp.name,
        description: `One-time purchase of ${topUp.credits} credits`,
        metadata: { type: "topup", credits: String(topUp.credits) },
      });
      productId = product.id;
      console.log(`[CREATE] ${topUp.name}: ${productId}`);
    }

    const prices = await stripe.prices.list({ product: productId, active: true, limit: 10 });
    const oneTimePrice = prices.data.find((p) => !p.recurring);

    if (oneTimePrice) {
      console.log(`[SKIP] One-time price already exists: ${oneTimePrice.id}`);
      envLines.push(`${topUp.envKey}=${oneTimePrice.id}`);
    } else {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: topUp.priceUsd * 100,
        currency: "usd",
        metadata: { type: "topup", credits: String(topUp.credits) },
      });
      console.log(`[CREATE] One-time $${topUp.priceUsd}: ${price.id}`);
      envLines.push(`${topUp.envKey}=${price.id}`);
    }
  }

  console.log("\n=== Add these to your .env.local / Replit Secrets ===\n");
  for (const line of envLines) {
    console.log(line);
  }
  console.log("\n✅ Done!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
