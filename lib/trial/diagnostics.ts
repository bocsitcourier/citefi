import { randomUUID } from "node:crypto";

export interface TrialFailureDiagnostic {
  reference: string;
  operation: string;
  category: string;
  databaseCode?: string;
  providerFailureCode?: string;
  errorStatus?: number;
  trialDocumentId?: number;
  sponsorTeamId?: number;
}
const DATABASE_CODES = new Set(["42P01", "42703", "42501", "23505", "23503", "40001", "40P01", "53300", "57P01", "57014", "08001", "08006"]);
const PROVIDER_CODES = new Set(["PROVIDER_ATTEMPT_NOT_DURABLE", "PROVIDER_ATTEMPT_USAGE_UNAVAILABLE",
  "PROVIDER_ATTEMPT_ACCOUNTING_FAILED", "PROVIDER_ATTEMPT_SUBMISSION_UNCERTAIN",
  "PROVIDER_REQUEST_NOT_SUBMITTED", "PROVIDER_ATTEMPT_ALREADY_SUBMITTED", "PROVIDER_SUBMISSION_UNCERTAIN"]);
const OPERATIONS = new Set(["request", "session", "read", "generate", "claim", "export", "generation_outcome"]);
const MAX_IN_FLIGHT_PERSISTENCE = 4;
let inFlightPersistence = 0;

/** Do not persist raw exceptions, prompts, cookies, provider bodies or URLs. */
export function trialFailureDiagnostic(
  error: unknown,
  operation: string,
  identity?: { trialDocumentId: number; sponsorTeamId: number },
): TrialFailureDiagnostic {
  const e = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = typeof e.message === "string" ? e.message : "";
  const category = message === "The free article sponsor has not been provisioned." ? "sponsor_not_provisioned"
    : message === "Free article pricing is unavailable within its sponsor budget." ? "sponsor_pricing_unavailable"
    : message === "Article trial configuration unavailable." ? "trial_session_configuration_unavailable"
    : message === "The article generator is not configured." ? "generator_not_configured"
    : message === "Incomplete provider article; automatic replay blocked" ? "incomplete_provider_article"
    : "unclassified_failure";
  const cause = e.cause && typeof e.cause === "object" ? e.cause as Record<string, unknown> : {};
  const code = [e.code, cause.code].find(value => typeof value === "string" && DATABASE_CODES.has(value));
  const providerCode = [e.code, cause.code].find(value => typeof value === "string" && PROVIDER_CODES.has(value));
  const status = [e.status, e.statusCode, cause.status, cause.statusCode].find(value =>
    typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599);
  return {
    reference: randomUUID(),
    operation: OPERATIONS.has(operation) ? operation : "request",
    category,
    ...(typeof code === "string" ? { databaseCode: code } : {}),
    ...(typeof providerCode === "string" ? { providerFailureCode: providerCode } : {}),
    ...(typeof status === "number" ? { errorStatus: status } : {}),
    ...(identity && Number.isSafeInteger(identity.trialDocumentId) && identity.trialDocumentId > 0 &&
      Number.isSafeInteger(identity.sponsorTeamId) && identity.sponsorTeamId > 0
      ? { trialDocumentId: identity.trialDocumentId, sponsorTeamId: identity.sponsorTeamId } : {}),
  };
}

export async function recordTrialFailure(
  diagnostic: TrialFailureDiagnostic,
  persist: (diagnostic: TrialFailureDiagnostic) => Promise<void>,
  waitMs = 2_000,
): Promise<string> {
  if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 2_000) throw new RangeError("Diagnostic wait must be bounded");
  // Console evidence remains available even when the database/telemetry sink fails.
  console.error("[public-article-trial:failure]", diagnostic);
  // A response timeout does not cancel a database write. Keep the slot until
  // the actual sink settles; otherwise an outage creates an unbounded queue.
  if (inFlightPersistence >= MAX_IN_FLIGHT_PERSISTENCE) {
    console.error("[public-article-trial:diagnostic-persistence-capacity]", { reference: diagnostic.reference });
    return diagnostic.reference;
  }
  inFlightPersistence++;
  let completed = false;
  const persistence = (async () => {
    try { await persist(diagnostic); }
    catch { console.error("[public-article-trial:diagnostic-persistence-failed]", { reference: diagnostic.reference }); }
    finally { completed = true; inFlightPersistence--; }
  })();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([persistence, new Promise<void>(resolve => { timeout = setTimeout(resolve, waitMs); })]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
  if (!completed) console.error("[public-article-trial:diagnostic-persistence-pending]", { reference: diagnostic.reference });
  return diagnostic.reference;
}
