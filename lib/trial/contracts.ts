import { z } from "zod";

export const TRIAL_COOKIE = "citefi_article_trial";
export const TRIAL_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const TRIAL_MODEL = "gemini-2.5-flash-lite";
export const TRIAL_RESERVE_MICROUSD = 50_000;
export const TRIAL_DAILY_LIMIT = 100;
export const TRIAL_HOURLY_LIMIT = 10;
export const trialInputSchema = z.object({
  topic: z.string().trim().min(8).max(180),
  businessName: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  audience: z.string().trim().min(2).max(160),
}).strict();
export type TrialInput = z.infer<typeof trialInputSchema>;
export type TrialStatus = "empty" | "created" | "generating" | "ready" | "uncertain";
export interface TrialView {
  status: TrialStatus;
  access: "preview" | "watermarked" | "paid";
  title?: string;
  preview?: string;
  text?: string;
  accountPending?: boolean;
  canExport: boolean;
  message?: string;
}
export function excerpt(text: string): string {
  return text.trim().split(/\s+/).slice(0, 65).join(" ") + "…";
}
export function watermarkArticle(text: string): string {
  return text.split(/\n\s*\n/).map(paragraph =>
    `[CITEFI FREE ARTICLE • READ ONLY]\n${paragraph}`).join("\n\n");
}
export function isPaidArticleAccess(team: {
  billingPlan: string; billingStatus: string; stripeSubscriptionId: string | null;
} | null | undefined): boolean {
  return !!team && team.billingPlan !== "free" && team.billingStatus === "active"
    && !!team.stripeSubscriptionId;
}
export function presentTrial(row: {
  status: string; title: string | null; preview: string | null; fullText: string | null;
  ownerUserId: number | null;
}, paid = false): TrialView {
  const claimed = row.ownerUserId !== null;
  const entitled = claimed && paid;
  return {
    status: row.status as TrialStatus,
    access: entitled ? "paid" : claimed ? "watermarked" : "preview",
    title: row.title ?? undefined, preview: row.preview ?? undefined,
    ...(claimed && row.status === "ready" ? {
      text: paid ? row.fullText ?? "" : watermarkArticle(row.fullText ?? ""),
    } : {}),
    canExport: claimed && paid && row.status === "ready",
    ...(row.status === "uncertain" ? {
      message: "We could not confirm completion. Your request is retained for support; we will not charge the provider again automatically.",
    } : {}),
  };
}
