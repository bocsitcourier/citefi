import { createHash } from "node:crypto";
import { z } from "zod";

// Shared with every manifest builder. The transaction must retain this lock
// through approval/job commit, not just through the object write.
export const REVIEW_RETENTION_LOCK = "publishing-reviewed-retention:v1";
export const REVIEW_KEY = /^private\/publishing-reviewed\/[1-9]\d*\/[a-f0-9]{64}\.(webp|png|jpg|jpeg|mp3|wav|mp4|ogg)$/;
export const REVIEW_ETAG = /^"[a-fA-F0-9]{32}(?:-\d+)?"$/;
const DAY = 86_400_000;
export const evidenceHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const retentionPolicySchema = z.object({
  version: z.literal(1),
  // Opaque governance reference, not a name/email or content.
  policyRef: z.string().min(1).max(200),
  target: z.string().regex(/^[a-f0-9]{64}$/),
  teams: z.array(z.object({
    teamId: z.number().int().positive(),
    orphanRetentionDays: z.number().int().min(7).max(36500),
    disposition: z.enum(["retain", "delete-unapproved-orphans"]),
    legalHold: z.boolean(),
    // Required operator certification: historical evidence was not pruned or
    // privacy-erased. Otherwise an absent reference cannot prove abandonment.
    approvalHistoryComplete: z.boolean(),
  }).strict()).superRefine((rows, ctx) => {
    if (new Set(rows.map(row => row.teamId)).size !== rows.length)
      ctx.addIssue({ code: "custom", message: "Duplicate team policies" });
  }),
}).strict();
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;
export interface ReviewCopy {
  key: string;
  size: number;
  etag: string;
  lastModified: string;
}
export interface ReferenceRows {
  teams: Record<string, any>[];
  articles: Record<string, any>[];
  article_assets: Record<string, any>[];
  activity_logs: Record<string, any>[];
  publishing_jobs: Record<string, any>[];
  publishing_callbacks: Record<string, any>[];
}

/** Scan whole rows, including historical/soft-deleted rows and arbitrary JSON
 * payloads, not just current approval flags or a shortlist of job statuses. */
export function indexReviewReferences(rows: ReferenceRows) {
  const references = new Set<string>();
  const blockedTeams = new Set<number>();
  let incomplete = false;
  for (const table of Object.values(rows)) for (const row of table) {
    const serialized = JSON.stringify(row);
    let decoded: string;
    try { decoded = decodeURIComponent(serialized); }
    catch {
      // A malformed unrelated URL need not hide ordinary canonical keys.
      decoded = serialized.replace(/%2f/gi, "/").replace(/%2e/gi, ".");
    }
    decoded = decoded.replace(/\\\//g, "/");
    const keys = decoded.match(/private\/publishing-reviewed\/[1-9]\d*\/[a-f0-9]{64}\.[a-z0-9]+/g) ?? [];
    keys.forEach(key => references.add(key));
    if ((decoded.match(/publishing-reviewed/gi) ?? []).length !== keys.length) incomplete = true;
  }
  const approvals = new Map<string, Record<string, any>>();
  for (const log of rows.activity_logs) {
    if (log.action !== "article_exact_review_approved") continue;
    const snapshot = log.details;
    if (!snapshot || snapshot.version !== 1 || typeof snapshot.reviewId !== "string" ||
        !Array.isArray(snapshot.assets) || snapshot.assets.some((asset: any) =>
          !asset || typeof asset.pinnedKey !== "string" || !REVIEW_KEY.test(asset.pinnedKey))) {
      if (Number.isSafeInteger(log.team_id)) blockedTeams.add(log.team_id);
      else incomplete = true;
      continue;
    }
    if (approvals.has(snapshot.reviewId)) incomplete = true;
    approvals.set(snapshot.reviewId, log);
  }
  for (const job of rows.publishing_jobs) {
    const reviewId = job.error_details?.dispatchContract?.reviewId;
    const approval = approvals.get(reviewId);
    // Unknown/legacy contracts, sent/uncertain work, terminal jobs with missing
    // history: never infer that their media is disposable.
    if (!approval || approval.team_id !== job.team_id || approval.resource_id !== job.article_id)
      blockedTeams.add(job.team_id);
  }
  for (const article of rows.articles) {
    if (article.approval_status !== "approved") continue;
    if (![...approvals.values()].some(log => log.team_id === article.team_id &&
        log.resource_id === article.id && log.details.reviewedBy === article.approval_reviewed_by &&
        new Date(log.details.reviewedAt).getTime() === new Date(article.approval_reviewed_at).getTime()))
      blockedTeams.add(article.team_id);
  }
  const jobs = new Set(rows.publishing_jobs.map(job => job.id));
  if (rows.publishing_callbacks.some(callback => !jobs.has(callback.publishing_job_id))) incomplete = true;
  return { references, blockedTeams, incomplete };
}

export function planReviewRetention(
  copies: ReviewCopy[], rows: ReferenceRows, policyInput: unknown, target: string, now = new Date(),
) {
  const policy = retentionPolicySchema.parse(policyInput);
  if (policy.target !== target) throw new Error("Retention policy target mismatch");
  const index = indexReviewReferences(rows);
  const decisions = copies.map(copy => {
    const teamId = Number(copy.key.split("/")[2]);
    const team = rows.teams.find(row => row.id === teamId);
    const rule = policy.teams.find(row => row.teamId === teamId);
    const age = now.getTime() - Date.parse(copy.lastModified);
    let reason = "eligible-unapproved-orphan";
    if (!REVIEW_KEY.test(copy.key) || !REVIEW_ETAG.test(copy.etag) || !Number.isSafeInteger(copy.size) || copy.size <= 0 ||
        !Number.isFinite(age) || age < 0) reason = "invalid-object-evidence";
    else if (index.references.has(copy.key)) reason = "referenced-version";
    else if (index.incomplete || index.blockedTeams.has(teamId)) reason = "incomplete-reference-evidence";
    else if (!team || team.deleted_at || team.client_status !== "active") reason = "privacy-or-archived-team-hold";
    else if (!rule || rule.legalHold || !rule.approvalHistoryComplete ||
        rule.disposition !== "delete-unapproved-orphans") reason = "policy-hold";
    else if (age < rule.orphanRetentionDays * DAY) reason = "retention-window";
    return { ...copy, teamId, decision: reason === "eligible-unapproved-orphan" ? "candidate" : "retain", reason };
  }).sort((a, b) => a.key.localeCompare(b.key));
  if (new Set(copies.map(copy => copy.key)).size !== copies.length) throw new Error("Duplicate inventory keys");
  return {
    version: 1 as const, target, policyHash: evidenceHash(policy),
    generatedAt: now.toISOString(), decisions,
    counts: {
      scanned: decisions.length,
      candidates: decisions.filter(row => row.decision === "candidate").length,
      retained: decisions.filter(row => row.decision === "retain").length,
    },
  };
}
export type RetentionPlan = ReturnType<typeof planReviewRetention>;

export const deletionAuthorizationSchema = z.object({
  version: z.literal(1),
  authorizationRef: z.string().min(1).max(200),
  target: z.string().regex(/^[a-f0-9]{64}$/),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(),
  allowDeletion: z.literal(true),
  conditionalDeleteCertified: z.literal(true),
}).strict();

/** Called only inside the reference/pin maintenance barrier. Old candidates
 * are reclassified; newly eligible copies are NEVER added to an approved run. */
export async function executeReviewRetention(input: {
  approved: RetentionPlan;
  fresh: RetentionPlan;
  authorization: unknown;
  now?: Date;
  remove: (copy: ReviewCopy) => Promise<void>;
  record: (event: { key: string; outcome: string }) => Promise<void>;
}) {
  const now = input.now ?? new Date();
  const authorization = deletionAuthorizationSchema.parse(input.authorization);
  const age = now.getTime() - Date.parse(input.approved.generatedAt);
  if (!Number.isFinite(age) || age < 0 || age > DAY ||
      Date.parse(authorization.expiresAt) <= now.getTime() ||
      authorization.target !== input.approved.target || authorization.target !== input.fresh.target ||
      authorization.planHash !== evidenceHash(input.approved) ||
      authorization.policyHash !== input.approved.policyHash ||
      input.approved.policyHash !== input.fresh.policyHash) throw new Error("Deletion authorization/evidence mismatch or expired");
  const current = new Map(input.fresh.decisions.map(copy => [copy.key, copy]));
  for (const copy of input.approved.decisions.filter(row => row.decision === "candidate")) {
    const fresh = current.get(copy.key);
    if (!fresh || fresh.decision !== "candidate" || fresh.etag !== copy.etag ||
        fresh.size !== copy.size || fresh.lastModified !== copy.lastModified) {
      await input.record({ key: copy.key, outcome: "skipped-changed-or-protected" });
      continue;
    }
    // Durable intent before destructive I/O. Errors stop the batch. Intent
    // without a result means uncertain; never report it as successful.
    await input.record({ key: copy.key, outcome: "delete-intent" });
    await input.remove(copy);
    await input.record({ key: copy.key, outcome: "deleted" });
  }
}
