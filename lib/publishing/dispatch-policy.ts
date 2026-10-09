import { createHash } from "node:crypto";
import type { Article, PublishingConnection } from "../../shared/schema";
import type { FormattedContent } from "./types";

export interface DispatchContract {
  version: 1;
  hash: string;
  submissionStarted: boolean;
  receiverOrigin?: string;
  receiverKeyHash?: string;
  reviewId?: string;
  publisherUserId?: number;
  publisherRole?: string;
  publisherMembership?: string;
}

export function dispatchContract(details: unknown): DispatchContract | null {
  if (!details || typeof details !== "object") return null;
  const value = (details as Record<string, unknown>).dispatchContract;
  if (!value || typeof value !== "object") return null;
  const contract = value as Record<string, unknown>;
  return contract.version === 1 && typeof contract.hash === "string" &&
    /^[a-f0-9]{64}$/.test(contract.hash) && typeof contract.submissionStarted === "boolean"
    ? contract as unknown as DispatchContract : null;
}

/** Approval is invalid once the article changes, including legacy edits that
 * forgot to reset approvalStatus. A new explicit review is required. */
export function assertReviewedArticle(article: Pick<Article,
  "articleStatus" | "approvalStatus" | "approvalReviewedAt" | "updatedAt" | "deletedAt"
>): void {
  if (article.deletedAt || article.articleStatus !== "COMPLETE" ||
      article.approvalStatus !== "approved" || !article.approvalReviewedAt ||
      !article.updatedAt || article.updatedAt.getTime() > article.approvalReviewedAt.getTime()) {
    throw Object.assign(new Error("Current, complete content must be explicitly approved before publishing"), {
      statusCode: 409, code: "CURRENT_APPROVAL_REQUIRED",
    });
  }
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function reviewHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Bind exactly the formatted content/media and effective receiver destination.
 * The website adapter ignores URL paths, so origin-equivalent URLs must dedupe. */
export function publicationHash(content: FormattedContent, connection: Pick<PublishingConnection, "channel" | "baseUrl">): string {
  const receiver = new URL(connection.baseUrl ?? "");
  if (receiver.protocol !== "https:") {
    throw Object.assign(new Error("Publishing receivers require HTTPS"), { statusCode: 400 });
  }
  return createHash("sha256").update(JSON.stringify(canonical({
    content, channel: connection.channel, receiver: receiver.origin,
  }))).digest("hex");
}

export function canRetryPublication(job: { status: string; lastAttemptAt: Date | null; errorDetails: unknown }): boolean {
  if (job.status !== "failed") return false;
  // No legacy job gains retry permission from missing attempt timestamps.
  // Only a trustworthy contract can prove the request was never submitted.
  const contract = dispatchContract(job.errorDetails);
  return !!contract && !contract.submissionStarted && !!contract.reviewId &&
    !!contract.publisherUserId && !!contract.publisherRole && !!contract.publisherMembership;
}

export function callbackMatchesAttempt(
  job: { status: string; attempts: number; lastAttemptAt: Date | null; errorDetails: unknown },
  attempt?: string,
): boolean {
  const contract = dispatchContract(job.errorDetails);
  if (!contract?.submissionStarted || !job.lastAttemptAt ||
      !["processing", "sent", "outcome_unknown"].includes(job.status)) return false;
  // Compatibility for receivers not yet echoing the signed dispatchAttempt:
  // only a newly bound operation's very first physical attempt is eligible.
  if (!attempt) return job.attempts === 1;
  return attempt === job.lastAttemptAt.toISOString();
}
