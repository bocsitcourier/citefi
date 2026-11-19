import { TRIAL_DAILY_LIMIT, TRIAL_HOURLY_LIMIT, TRIAL_RESERVE_MICROUSD } from "./contracts";

export const TRIAL_READINESS_FAILURES = [
  "sponsor_not_provisioned", "sponsor_pricing_unavailable", "generator_not_configured",
  "initialization_blocked", "daily_budget_exhausted", "admission_at_capacity",
  "readiness_unavailable",
] as const;
export type TrialReadinessFailure = typeof TRIAL_READINESS_FAILURES[number];
export interface TrialReadiness {
  ok: boolean;
  check: "free_article_readiness";
  delivery: "not_tested";
  providerRequests: 0;
  failures: TrialReadinessFailure[];
}
export interface TrialReadinessSnapshot {
  sponsor: boolean;
  rate: { input: unknown; output: unknown } | null;
  spent: unknown;
  daily: unknown;
  hourly: unknown;
  concurrent: unknown;
  sessions: unknown;
  generatorConfigured: boolean;
  sessionConfigured: boolean;
}
function monetaryInteger(value: unknown): number {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return NaN;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : NaN;
}
export function trialRateFitsReservation(rate: TrialReadinessSnapshot["rate"]): boolean {
  if (!rate) return false;
  const input = monetaryInteger(rate.input), output = monetaryInteger(rate.output);
  // BigInt avoids precision loss in multiplication at high configured rates.
  return Number.isFinite(input) && Number.isFinite(output) &&
    (BigInt(input) * 4096n + BigInt(output) * 1800n + 999999n) / 1000000n <= BigInt(TRIAL_RESERVE_MICROUSD);
}
/** A point-in-time preflight, never a reservation, provider test or delivery proof. */
export function evaluateTrialReadiness(snapshot: TrialReadinessSnapshot): TrialReadiness {
  const failures: TrialReadinessFailure[] = [];
  if (!snapshot.sponsor) failures.push("sponsor_not_provisioned");
  if (!trialRateFitsReservation(snapshot.rate)) failures.push("sponsor_pricing_unavailable");
  if (!snapshot.generatorConfigured) failures.push("generator_not_configured");
  if (!snapshot.sessionConfigured || monetaryInteger(snapshot.sessions) >= 1000) failures.push("initialization_blocked");
  if (monetaryInteger(snapshot.spent) >= TRIAL_DAILY_LIMIT * TRIAL_RESERVE_MICROUSD) failures.push("daily_budget_exhausted");
  if (monetaryInteger(snapshot.daily) >= TRIAL_DAILY_LIMIT ||
      monetaryInteger(snapshot.hourly) >= TRIAL_HOURLY_LIMIT ||
      monetaryInteger(snapshot.concurrent) >= 3) failures.push("admission_at_capacity");
  if ([snapshot.spent, snapshot.daily, snapshot.hourly, snapshot.concurrent, snapshot.sessions]
    .some(value => !Number.isFinite(monetaryInteger(value)))) failures.push("readiness_unavailable");
  return { ok: failures.length === 0, check: "free_article_readiness",
    delivery: "not_tested", providerRequests: 0, failures };
}
