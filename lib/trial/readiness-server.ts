import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getTxDb } from "@/lib/db";
import { runWithSystemContext } from "@/lib/tenant-context";
import { TRIAL_MODEL, TRIAL_STALE_AFTER_MS } from "./contracts";
import { evaluateTrialReadiness, type TrialReadiness } from "./readiness";
import { recordTrialFailure } from "./diagnostics";
import { getTrialSessionRateLimitKey } from "./session-rate-limit-key";

/** Only aggregate reads under the same explicit system boundary as the trial.
 * Never call readTrial here: it can change stale generating rows to uncertain.
 */
export async function inspectTrialReadiness(): Promise<TrialReadiness> {
  return runWithSystemContext("read-only free article operational readiness", () =>
    getTxDb().transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
      const sponsor = await tx.execute(sql`SELECT s.team_id FROM public_trial_sponsor s
        JOIN teams t ON t.id=s.team_id WHERE t.deleted_at IS NULL LIMIT 1`);
      const teamId = sponsor.rows[0]?.team_id;
      const pricing = await tx.execute(sql`SELECT r.input_microusd_per_million AS input,
        r.output_microusd_per_million AS output FROM provider_rates r
        JOIN provider_rate_versions v ON v.id=r.rate_version_id
        WHERE r.provider='gemini' AND r.model=${TRIAL_MODEL} AND r.unit_type='tokens'
          AND v.locked_at IS NOT NULL AND r.effective_from<=now()
          AND (r.effective_to IS NULL OR r.effective_to>now())
          AND v.effective_from<=now() AND (v.effective_to IS NULL OR v.effective_to>now())
        ORDER BY r.effective_from DESC, r.id DESC LIMIT 1`);
      // Match the admission path's concurrency check after it retires stale
      // attempts to uncertain. Stale attempts still count toward spend limits.
      const totals = await tx.execute(sql`SELECT
        count(*) FILTER(WHERE started_at>=date_trunc('day',now())) AS daily,
        count(*) FILTER(WHERE started_at>now()-interval '1 hour') AS hourly,
        count(*) FILTER(WHERE status='generating'
          AND (started_at IS NULL OR started_at>=now()-${TRIAL_STALE_AFTER_MS}*interval '1 millisecond')) AS concurrent,
        count(*) FILTER(WHERE created_at>now()-interval '24 hours') AS sessions
        FROM public_trial_documents`);
      const spent = await tx.execute(sql`SELECT coalesce(sum(cost_microusd),0) AS total
        FROM provider_usage_ledger WHERE team_id=${teamId ?? null}
          AND occurred_at>=date_trunc('day',now())`);
      const counts = totals.rows[0];
      const rate = pricing.rows[0];
      return evaluateTrialReadiness({
        sponsor: teamId != null, rate: rate ? { input: rate.input, output: rate.output } : null,
        spent: spent.rows[0]?.total, daily: counts?.daily, hourly: counts?.hourly,
        concurrent: counts?.concurrent, sessions: counts?.sessions,
        generatorConfigured: Boolean(process.env.GEMINI_API_KEY),
        sessionConfigured: getTrialSessionRateLimitKey() !== null,
      });
    }, { accessMode: "read only", isolationLevel: "repeatable read" }));
}

export type TrialReadinessReport = TrialReadiness & { reference: string; checkedAt: string };
let cached: { expires: number; report: TrialReadinessReport } | undefined;
let pending: Promise<TrialReadinessReport> | undefined;

/** Bound public probing and incident creation to one in-flight check per process
 * and one report per minute. No visitor identities, documents or sessions created.
 */
export function getTrialReadiness(): Promise<TrialReadinessReport> {
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.report);
  if (pending) return pending;
  pending = (async () => {
    let result: TrialReadiness;
    try { result = await inspectTrialReadiness(); }
    catch {
      result = { ok: false, check: "free_article_readiness", delivery: "not_tested",
        providerRequests: 0, failures: ["readiness_unavailable"] };
    }
    const report = { ...result, reference: randomUUID(), checkedAt: new Date().toISOString() };
    if (!report.ok) {
      await recordTrialFailure({
        reference: report.reference, operation: "readiness", category: report.failures.join(","),
      }, async diagnostic => runWithSystemContext("free article readiness incident", async () => {
        const { logError } = await import("@/lib/error-logger");
        await logError({
          errorType: "SYSTEM", severity: "error", component: "PublicArticleTrial",
          errorMessage: "Free article operational readiness failed; no generation was attempted.",
          requestId: diagnostic.reference, context: { ...diagnostic, delivery: "not_tested", providerRequests: 0 },
        });
      }));
    }
    cached = { expires: Date.now() + 60_000, report };
    return report;
  })().finally(() => { pending = undefined; });
  return pending;
}
