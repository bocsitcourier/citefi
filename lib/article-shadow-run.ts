import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { errorLogs, type ErrorLog } from "@/shared/schema";

const ARTICLE_FAILURE_TYPES = new Set([
  "GENERATION",
  "VALIDATION",
  "BRAND_VALIDATION",
  "IMAGE_BRAND_VALIDATION",
  "CHATGPT_REVIEW",
  "CHATGPT_REVIEW_CRITICAL",
  "QUEUE",
]);

export interface ShadowRunFailurePattern {
  key: string;
  instruction: string;
  frequency: number;
  sourceTypes: string[];
  recentExample: string;
}

export interface ArticleShadowRunPlan {
  summary: string;
  failurePatterns: ShadowRunFailurePattern[];
  recentErrors: Array<{
    errorType: string;
    errorMessage: string;
  }>;
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;
}

function toFailureInstruction(log: Pick<ErrorLog, "errorType" | "errorMessage">): {
  key: string;
  instruction: string;
} {
  const errorType = log.errorType.toUpperCase();
  const errorMessage = log.errorMessage.toLowerCase();

  if (
    errorType.includes("BRAND") ||
    /brand|placeholder|hallucination|logo|uniform/i.test(log.errorMessage)
  ) {
    return {
      key: "brand-lock",
      instruction:
        "Use the exact business name and brand details everywhere; never use placeholders or altered branding.",
    };
  }

  if (
    errorType.includes("VALIDATION") ||
    /json|schema|required|missing|meta description|seo title|slug|faq/i.test(
      log.errorMessage,
    )
  ) {
    return {
      key: "structured-output",
      instruction:
        "Return complete, valid JSON with article text, SEO fields, FAQ entries, and the required image prompts.",
    };
  }

  if (
    errorType.includes("CHATGPT_REVIEW") ||
    /review|rewrite|evidence|unsupported|citation|authority/i.test(
      errorMessage,
    )
  ) {
    return {
      key: "review-readiness",
      instruction:
        "Keep claims specific, evidence-backed, and reviewer-ready so the downstream enrichment pass does not need to rescue the draft.",
    };
  }

  if (
    errorType.includes("GENERATION") ||
    /timeout|hang|word count|too long|latency/i.test(errorMessage)
  ) {
    return {
      key: "generation-discipline",
      instruction:
        "Stay inside the requested word-count band, answer directly, and avoid tangents that increase latency or stall the model.",
    };
  }

  if (/heading|paragraph|markdown|html|format/i.test(errorMessage)) {
    return {
      key: "format-discipline",
      instruction:
        "Follow the required markdown structure with answer-first sections, clear headings, and extractable paragraphs.",
    };
  }

  return {
    key: `generic-${errorType.toLowerCase()}`,
    instruction: truncateText(
      `Avoid repeating the recent ${errorType.toLowerCase()} failure: ${log.errorMessage}`,
      180,
    ),
  };
}

function buildSummary(input: {
  title: string;
  geographicFocus?: string;
  failurePatterns: ShadowRunFailurePattern[];
}): string {
  const summarySegments = [
    `Plan: answer "${input.title}" directly in the opening paragraph.`,
    input.geographicFocus
      ? `Ground examples and proof in ${input.geographicFocus}.`
      : null,
    ...input.failurePatterns.slice(0, 3).map((pattern) => pattern.instruction),
  ].filter(Boolean) as string[];

  return truncateWords(summarySegments.join(" "), 50);
}

export async function buildArticleShadowRunPlan(input: {
  articleId: number;
  /** Scopes error log reads to this batch to prevent cross-tenant data leakage into Gemini prompts. */
  batchId?: number;
  title: string;
  geographicFocus?: string;
}): Promise<ArticleShadowRunPlan> {
  const recentLogs = await db
    .select({
      errorType: errorLogs.errorType,
      errorMessage: errorLogs.errorMessage,
      articleId: errorLogs.articleId,
    })
    .from(errorLogs)
    // Scope to this batch when available; falls back to global last-50 only when no batchId is set.
    // This prevents error messages from other tenants' jobs from leaking into Gemini prompts.
    .where(input.batchId ? eq(errorLogs.batchId, input.batchId) : undefined)
    .orderBy(desc(errorLogs.createdAt))
    .limit(50);

  const recentArticleFailures = recentLogs.filter(
    (log) =>
      ARTICLE_FAILURE_TYPES.has(log.errorType) &&
      (log.articleId !== null || log.errorType !== "QUEUE"),
  );

  const lastFiveFailures = recentArticleFailures.slice(0, 5);
  const patternMap = new Map<string, ShadowRunFailurePattern>();

  for (const log of recentArticleFailures) {
    const normalized = toFailureInstruction(log);
    const existing = patternMap.get(normalized.key);

    if (existing) {
      existing.frequency += 1;
      if (!existing.sourceTypes.includes(log.errorType)) {
        existing.sourceTypes.push(log.errorType);
      }
      continue;
    }

    patternMap.set(normalized.key, {
      key: normalized.key,
      instruction: normalized.instruction,
      frequency: 1,
      sourceTypes: [log.errorType],
      recentExample: truncateText(log.errorMessage, 180),
    });
  }

  const failurePatterns = [...patternMap.values()]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5);

  if (!failurePatterns.length) {
    failurePatterns.push({
      key: "baseline-discipline",
      instruction:
        "Answer directly, stay within the target word count, keep structure extractable, and return complete JSON on the first pass.",
      frequency: 0,
      sourceTypes: [],
      recentExample: "No recent article-specific failures were found.",
    });
  }

  return {
    summary: buildSummary({
      title: input.title,
      geographicFocus: input.geographicFocus,
      failurePatterns,
    }),
    failurePatterns,
    recentErrors: lastFiveFailures.map((log) => ({
      errorType: log.errorType,
      errorMessage: truncateText(log.errorMessage, 180),
    })),
  };
}

export function buildShadowRunPromptPreamble(
  plan: ArticleShadowRunPlan,
): string {
  return `
**SHADOW RUN PRE-FLIGHT PLAN (MANDATORY):**
${plan.summary}

Recent failure patterns to avoid:
${plan.failurePatterns
  .map(
    (pattern, index) =>
      `${index + 1}. ${pattern.instruction} (seen ${pattern.frequency}x${
        pattern.sourceTypes.length
          ? ` across ${pattern.sourceTypes.join(", ")}`
          : ""
      })`,
  )
  .join("\n")}

Recent failure examples:
${plan.recentErrors.length
  ? plan.recentErrors
      .map(
        (error, index) =>
          `${index + 1}. [${error.errorType}] ${error.errorMessage}`,
      )
      .join("\n")
  : "None recorded."}

Before drafting, silently verify that your article plan satisfies every rule above. Do not mention this shadow run or these failure logs in the final JSON output.
`.trim();
}
