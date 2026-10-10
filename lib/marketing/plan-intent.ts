import { SELF_SERVE_PLAN_IDS, type PlanId } from "@/lib/billing/plans";
export function marketingPlan(value: string | null | undefined): PlanId | undefined {
  return SELF_SERVE_PLAN_IDS.find(id => id === value);
}
export function planPricingPath(plan: string | null | undefined, annual = false): string {
  const id = marketingPlan(plan);
  return id ? `/pricing?plan=${id}${annual ? "&interval=annual" : ""}#plans` : "/pricing#plans";
}
export function planLoginPath(plan: string | null | undefined, annual = false): string {
  return marketingPlan(plan) ? `/login?redirect=${encodeURIComponent(planPricingPath(plan, annual))}` : "/login";
}
/** Only the marketing purchase destination, never arbitrary external URLs or application actions. */
export function marketingPricingReturn(value: string | null | undefined): string | undefined {
  if (!value?.startsWith("/pricing?")) return undefined;
  const parsed = new URL(value, "https://citefi.co");
  const plan = marketingPlan(parsed.searchParams.get("plan"));
  return plan ? planPricingPath(plan, parsed.searchParams.get("interval") === "annual") : undefined;
}

type PreferenceStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type MarketingPlanIntent = { plan: PlanId; annual: boolean; savedAt: number };
const preferenceKey = "citefi_marketing_plan_preference";
const preferenceLifetime = 14 * 24 * 60 * 60 * 1000;
function browserStore(): PreferenceStore | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}
/** Non-secret shopping preference only. Never used by server billing or authorization. */
export function saveMarketingPlanIntent(plan: string, annual: boolean, store = browserStore(), now = Date.now()): void {
  const id = marketingPlan(plan);
  if (!id || !store) return;
  try { store.setItem(preferenceKey, JSON.stringify({ plan: id, annual: !!annual, savedAt: now })); } catch { /* Private browsers may disallow preference storage; explicit URLs still work. */ }
}
export function readMarketingPlanIntent(store = browserStore(), now = Date.now()): MarketingPlanIntent | undefined {
  if (!store) return undefined;
  try {
    const raw = JSON.parse(store.getItem(preferenceKey) || "null");
    const plan = marketingPlan(raw?.plan);
    if (!plan || typeof raw.annual !== "boolean" || typeof raw.savedAt !== "number" || !Number.isFinite(raw.savedAt) || raw.savedAt > now || now - raw.savedAt > preferenceLifetime) {
      store.removeItem(preferenceKey); return undefined;
    }
    return { plan, annual: raw.annual, savedAt: raw.savedAt };
  } catch { return undefined; }
}
export function savedMarketingPricingPath(): string | undefined {
  const saved = readMarketingPlanIntent();
  return saved ? planPricingPath(saved.plan, saved.annual) : undefined;
}
export function planSignupPath(returnTo?: string | null, saved?: MarketingPlanIntent): string {
  const valid = marketingPricingReturn(returnTo);
  const url = valid ? new URL(valid, "https://citefi.co") : undefined;
  const plan = marketingPlan(url?.searchParams.get("plan")) || marketingPlan(saved?.plan);
  const annual = url ? url.searchParams.get("interval") === "annual" : saved?.annual;
  return plan ? `/signup?plan=${plan}&interval=${annual ? "annual" : "monthly"}` : "/signup";
}
