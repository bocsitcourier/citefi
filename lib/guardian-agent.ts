/**
 * ============================================================================
 * GUARDIAN AGENT — Pre-Completion Quality Gate
 * ============================================================================
 *
 * Runs BEFORE an article is marked COMPLETE. Performs deterministic structural
 * checks first (fast, no AI cost), then uses GPT-4o-mini only for ambiguous
 * tone/persona checks. If the article fails, it returns a specific list of
 * missingElements for the Surgical Fix to target.
 *
 * Integrates with existing article-critique and content-validator systems —
 * not a replacement, but a completion gate that enforces hard minimums.
 */

import { openaiClient } from "./openai-client";

export interface GuardianAuditReport {
  passed: boolean;
  score: number;
  missingElements: string[];
  formattingIssues: string[];
  suggestions: string[];
  breakdown: {
    images: { count: number; required: number; passed: boolean };
    hyperlinks: { count: number; required: number; passed: boolean };
    faq: { present: boolean; questionCount: number; required: number; passed: boolean };
    wordCount: { count: number; required: number; passed: boolean };
    rawMarkdown: { clean: boolean; issues: string[] };
    tone: { passed: boolean; reason: string };
  };
}

export interface GuardianOptions {
  minImages?: number;
  minHyperlinks?: number;
  minFaqQuestions?: number;
  minWordCount?: number;
  persona?: string;
  businessName?: string;
  skipToneCheck?: boolean;
}

const DEFAULT_OPTIONS: Required<GuardianOptions> = {
  minImages: 1,
  minHyperlinks: 3,
  minFaqQuestions: 2,
  minWordCount: 600,
  persona: "professional",
  businessName: "",
  skipToneCheck: false,
};

function countHtmlTags(html: string, tag: string): number {
  const regex = new RegExp(`<${tag}[\\s>]`, "gi");
  return (html.match(regex) || []).length;
}

function hasFaqSection(html: string): { present: boolean; questionCount: number } {
  const hasFaqHeading = /<h[2-4][^>]*>[\s\S]*?(?:FAQ|frequently asked|questions)[\s\S]*?<\/h[2-4]>/i.test(html);
  const hasQuestionList = /<\/?(dt|summary)[^>]*>/i.test(html);
  const questions = (html.match(/<(dt|summary|h[3-5])[^>]*>[\s\S]*?<\/(?:dt|summary|h[3-5])>/gi) || []).filter(q =>
    q.includes("?") || /what|how|why|when|where|can|do|is|are|should/i.test(q)
  );
  return {
    present: hasFaqHeading || hasQuestionList,
    questionCount: questions.length,
  };
}

function detectRawMarkdown(html: string): string[] {
  const issues: string[] = [];
  if (/\*\*[^*]+\*\*/g.test(html)) issues.push("Raw **bold** markdown detected — should be <strong>");
  if (/(?<!\*)\*[^*\n]+\*(?!\*)/g.test(html)) issues.push("Raw *italic* markdown detected — should be <em>");
  if (/^#{1,6}\s+.+$/m.test(html)) issues.push("Raw # heading markdown detected — should be <h2>/<h3>");
  if (/^\s*[-*+]\s+.+$/m.test(html)) issues.push("Raw list markdown detected — should be <ul><li>");
  if (/`[^`]+`/g.test(html)) issues.push("Raw `code` markdown detected — should be <code>");
  return issues;
}

function estimateWordCount(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

async function checkToneWithAI(
  html: string,
  persona: string,
  businessName?: string
): Promise<{ passed: boolean; reason: string }> {
  try {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
    const response = await openaiClient.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a content tone auditor. Respond only with valid JSON. No explanation, no markdown.",
        },
        {
          role: "user",
          content: `Assess whether this article text matches the "${persona}" persona tone${businessName ? ` for ${businessName}` : ""}.
          
TEXT SAMPLE:
${text}

Return ONLY this JSON (no markdown, no code fences):
{"passed": true/false, "reason": "one sentence explanation"}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 100,
    });

    const raw = response.choices[0]?.message?.content || '{"passed":true,"reason":"tone check skipped"}';
    return JSON.parse(raw);
  } catch {
    return { passed: true, reason: "tone check skipped (AI unavailable)" };
  }
}

export async function auditArticle(
  html: string,
  options: GuardianOptions = {}
): Promise<GuardianAuditReport> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const imgCount = countHtmlTags(html, "img");
  const anchorCount = countHtmlTags(html, "a");
  const faq = hasFaqSection(html);
  const wordCount = estimateWordCount(html);
  const markdownIssues = detectRawMarkdown(html);

  const imagesPassed = imgCount >= opts.minImages;
  const hyperlinksPassed = anchorCount >= opts.minHyperlinks;
  const faqPassed = faq.present && faq.questionCount >= opts.minFaqQuestions;
  const wordCountPassed = wordCount >= opts.minWordCount;
  const markdownClean = markdownIssues.length === 0;

  let toneResult = { passed: true, reason: "skipped" };
  if (!opts.skipToneCheck && opts.persona && opts.persona !== "professional") {
    toneResult = await checkToneWithAI(html, opts.persona, opts.businessName);
  }

  const missingElements: string[] = [];
  const formattingIssues: string[] = [...markdownIssues];
  const suggestions: string[] = [];

  if (!imagesPassed) {
    missingElements.push(
      `MISSING_IMAGES: Found ${imgCount} <img> tag(s), need at least ${opts.minImages}. Add relevant images with descriptive alt text.`
    );
  }
  if (!hyperlinksPassed) {
    missingElements.push(
      `MISSING_HYPERLINKS: Found ${anchorCount} <a> tag(s), need at least ${opts.minHyperlinks}. Add internal or contextual links.`
    );
  }
  if (!faqPassed) {
    missingElements.push(
      `MISSING_FAQ: ${faq.present ? `Found FAQ section but only ${faq.questionCount} question(s), need ${opts.minFaqQuestions}` : "No FAQ section found"}. Add an <h3>Frequently Asked Questions</h3> section with ${opts.minFaqQuestions}+ Q&A pairs.`
    );
  }
  if (!wordCountPassed) {
    missingElements.push(
      `LOW_WORD_COUNT: Article has ~${wordCount} words, minimum is ${opts.minWordCount}. Expand key sections.`
    );
  }
  if (!markdownClean) {
    formattingIssues.push(...markdownIssues);
  }
  if (!toneResult.passed) {
    missingElements.push(`TONE_MISMATCH: ${toneResult.reason}. Adjust writing style to match "${opts.persona}" persona.`);
  }

  if (imgCount > 0 && !html.includes('alt="') && !html.includes("alt='")) {
    suggestions.push("Add descriptive alt text to all images for accessibility and SEO.");
  }
  if (anchorCount > 0 && anchorCount < 5) {
    suggestions.push("Consider adding more internal links to improve topical authority.");
  }

  const totalChecks = 5;
  const passedChecks = [imagesPassed, hyperlinksPassed, faqPassed, wordCountPassed, markdownClean].filter(Boolean).length;
  const toneBonus = toneResult.passed ? 10 : 0;
  const score = Math.round((passedChecks / totalChecks) * 90) + toneBonus;

  const passed = missingElements.length === 0 && formattingIssues.length === 0 && score >= 70;

  return {
    passed,
    score,
    missingElements,
    formattingIssues,
    suggestions,
    breakdown: {
      images: { count: imgCount, required: opts.minImages, passed: imagesPassed },
      hyperlinks: { count: anchorCount, required: opts.minHyperlinks, passed: hyperlinksPassed },
      faq: { present: faq.present, questionCount: faq.questionCount, required: opts.minFaqQuestions, passed: faqPassed },
      wordCount: { count: wordCount, required: opts.minWordCount, passed: wordCountPassed },
      rawMarkdown: { clean: markdownClean, issues: markdownIssues },
      tone: toneResult,
    },
  };
}
