import Stripe from "stripe";

async function getStripeCredentials(): Promise<{ secretKey: string; webhookSecret?: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (key) return { secretKey: key, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET };
    throw new Error(
      "Stripe integration not connected. Connect Stripe via the Integrations tab."
    );
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!resp.ok) {
    throw new Error(`Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  const settings = data.items?.[0]?.settings;

  if (!settings?.secret_key) {
    throw new Error(
      "Stripe integration not connected or missing secret key. Connect Stripe via the Integrations tab."
    );
  }

  return {
    secretKey: settings.secret_key,
    webhookSecret: settings.webhook_secret,
  };
}

export async function getStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey, { apiVersion: "2025-05-28.basil" });
}

export async function getStripeWebhookSecret(): Promise<string> {
  const { webhookSecret } = await getStripeCredentials();
  if (!webhookSecret) throw new Error("Stripe webhook secret not configured");
  return webhookSecret;
}
