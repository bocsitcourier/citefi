import type { Job } from "bullmq";

export type ArticleGenerationBillingJobData = {
  teamId: number;
  creditRunId?: string;
  creditCostPerUnit?: number;
  articleId: number;
};

/**
 * Pure article billing identity resolver shared by the worker and contract
 * tests. Keep this outside lib/worker.ts so callers do not initialize live
 * BullMQ workers merely to resolve a reservation slice.
 */
export async function getArticleGenerationBilling(
  job: Pick<Job<ArticleGenerationBillingJobData>, "data">
) {
  return {
    teamId: job.data.teamId,
    runId: job.data.creditRunId,
    // Legacy jobs predating creditCostPerUnit must resolve the normal article
    // price. Leaving amount undefined would release the entire batch reserve.
    amount:
      job.data.creditCostPerUnit ??
      (await import("@/lib/credit-menu")).getCreditCost("article") ??
      10,
    releaseKey: `article:${job.data.articleId}`,
    reason: `Article ${job.data.articleId} generation failed`,
  };
}