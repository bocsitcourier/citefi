/**
 * Final delivery gate for generated text. This is intentionally a small
 * composition layer: structural/URL checks, claim review, and policy review
 * remain owned by their established modules.
 */
import {
  type ArticleOutputValidationOptions,
  validateArticleOutput,
} from "./article-output-safety";
import {
  enforceSocialCaptionWithHashtags,
  isValidSocialUrl,
  type SocialCaptionWithHashtags,
} from "./social-validation";
import {
  getApplicableBrandPolicy,
  type ApplicableBrandPolicy,
} from "./client-brand-profile-service";
import { contentReviewService } from "./content-review-service";

export class FinalizationQualityGateError extends Error {
  readonly code = "QUALITY_GATE_FAILED";
  readonly nonRetryable = true;

  constructor(
    readonly reasons: string[],
    readonly contentType: "article" | "social",
  ) {
    super(`QUALITY_GATE_FAILED: ${reasons.join("; ")}`);
    this.name = "FinalizationQualityGateError";
  }
}

type ReviewResult = {
  passed: boolean;
  defects: Array<{ code: string; evidence?: string }>;
};

type ReviewContent = (
  teamId: number,
  contentId: number,
  contentType: string,
  content: string,
  brief: { targetWords?: number; keyword?: string },
  opts: { useJudge: boolean },
) => Promise<ReviewResult>;

type BrandPolicyLoader = (
  teamId: number,
  campaignId: number | null,
) => Promise<ApplicableBrandPolicy>;

export interface FinalizationGateDependencies {
  reviewContent?: ReviewContent;
  loadBrandPolicy?: BrandPolicyLoader;
}

function reviewReasons(review: ReviewResult): string[] {
  if (review.passed) return [];
  if (review.defects.length === 0) return ["claim/quality reviewer did not approve output"];
  return review.defects.slice(0, 8).map((defect) =>
    `reviewer rejected ${defect.code}${defect.evidence ? `: ${defect.evidence.slice(0, 160)}` : ""}`,
  );
}

async function policyReasons(
  teamId: number,
  campaignId: number | null,
  content: string,
  loadBrandPolicy: BrandPolicyLoader,
): Promise<string[]> {
  try {
    const policy = await loadBrandPolicy(teamId, campaignId);
    if (!policy.applicable) return [];
    if (!policy.policy) return ["applicable brand policy was not available for execution"];
    // Reuse the campaign launch policy evaluator rather than maintaining a
    // second phrase/disclaimer implementation for article or social copy.
    const { deterministicPolicyCheck } = await import("./campaign-ads-service");
    const result = deterministicPolicyCheck(
      { headlines: [content], descriptions: [] },
      { variants: [] },
      { brandPolicyPack: policy.policy },
    );
    if (!result.blocksExport) return [];
    return [
      ...result.prohibitedMatches.map((phrase) => `brand policy prohibits "${phrase}"`),
      ...result.unresolvedDisclaimers.map(
        (disclaimer) => `required brand disclaimer is missing: "${disclaimer}"`,
      ),
    ];
  } catch (error) {
    return [
      error instanceof Error
        ? `brand policy review unavailable: ${error.message}`
        : "brand policy review unavailable",
    ];
  }
}

/**
 * Throws a typed fatal error before COMPLETE is written. The reviewer is
 * explicitly invoked with its judge enabled; unavailable/rejected evidence
 * blocks delivery rather than being treated as a pass.
 */
export async function assertArticleFinalizationQuality(
  input: {
    teamId: number;
    campaignId?: number | null;
    articleId: number;
    content: string;
    targetWords?: number;
    keyword?: string;
    outputOptions: ArticleOutputValidationOptions;
  },
  dependencies: FinalizationGateDependencies = {},
): Promise<void> {
  const structural = validateArticleOutput(input.content, input.outputOptions);
  const reasons = [...structural.reasons];
  // Do not spend a reviewer call on malformed/over-limit model output.
  if (reasons.length > 0) {
    throw new FinalizationQualityGateError(reasons, "article");
  }
  const reviewContent = dependencies.reviewContent ??
    (contentReviewService.reviewContent.bind(contentReviewService) as ReviewContent);
  try {
    const review = await reviewContent(
      input.teamId,
      input.articleId,
      "article",
      input.content,
      { targetWords: input.targetWords, keyword: input.keyword },
      { useJudge: true },
    );
    reasons.push(...reviewReasons(review));
  } catch (error) {
    reasons.push(
      error instanceof Error
        ? `claim/quality reviewer unavailable: ${error.message}`
        : "claim/quality reviewer unavailable",
    );
  }
  reasons.push(...await policyReasons(
    input.teamId,
    input.campaignId ?? null,
    input.content,
    dependencies.loadBrandPolicy ?? getApplicableBrandPolicy,
  ));
  if (reasons.length > 0) throw new FinalizationQualityGateError(reasons, "article");
}

export async function assertSocialFinalizationQuality<T extends { tag: string; mailtoLink: string }>(
  input: {
    teamId: number;
    campaignId?: number | null;
    socialPostId: number;
    platform: string;
    caption: string;
    hashtags: readonly T[];
    hyperlinks: readonly { url: string }[];
    sourceText?: string;
    keyword?: string;
  },
  dependencies: FinalizationGateDependencies = {},
): Promise<SocialCaptionWithHashtags<T>> {
  const normalized = enforceSocialCaptionWithHashtags(
    input.caption,
    input.hashtags,
    input.platform,
    input.sourceText,
  );
  const reasons = [...normalized.issues];
  if (normalized.caption !== input.caption.trim()) {
    reasons.push("caption was not normalized before final persistence");
  }
  if (input.hyperlinks.some((hyperlink) => !isValidSocialUrl(hyperlink.url))) {
    reasons.push("social output contains an invalid hyperlink destination");
  }
  // As with articles, basic local rejection is terminal before a paid judge.
  if (reasons.length > 0) {
    throw new FinalizationQualityGateError(reasons, "social");
  }
  const reviewContent = dependencies.reviewContent ??
    (contentReviewService.reviewContent.bind(contentReviewService) as ReviewContent);
  try {
    const review = await reviewContent(
      input.teamId,
      input.socialPostId,
      "social",
      normalized.caption,
      { keyword: input.keyword },
      { useJudge: true },
    );
    reasons.push(...reviewReasons(review));
  } catch (error) {
    reasons.push(
      error instanceof Error
        ? `claim/quality reviewer unavailable: ${error.message}`
        : "claim/quality reviewer unavailable",
    );
  }
  reasons.push(...await policyReasons(
    input.teamId,
    input.campaignId ?? null,
    normalized.caption,
    dependencies.loadBrandPolicy ?? getApplicableBrandPolicy,
  ));
  if (reasons.length > 0) throw new FinalizationQualityGateError(reasons, "social");
  return normalized;
}