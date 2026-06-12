/**
 * ============================================================================
 * SURGICAL FIX — Targeted Article Repair
 * ============================================================================
 *
 * Uses GPT-4o at low temperature to patch ONLY the specific missing elements
 * identified by the Guardian Agent. It acts as an editor, not a writer —
 * preserving all existing content and only injecting what's missing.
 *
 * Key constraint: the AI is instructed to keep >90% of original text intact.
 * This prevents "rewrite amnesia" where fixing one issue breaks another.
 */

import { openaiClient } from "./openai-client";

export interface SurgicalFixResult {
  html: string;
  appliedFixes: string[];
  unchanged: boolean;
  tokenCount?: number;
}

export async function applySurgicalFix(params: {
  html: string;
  missingElements: string[];
  formattingIssues?: string[];
  businessName?: string;
  persona?: string;
  targetUrl?: string;
  keywords?: string[];
  geographicFocus?: string;
}): Promise<SurgicalFixResult> {
  const {
    html,
    missingElements,
    formattingIssues = [],
    businessName,
    persona,
    targetUrl,
    keywords = [],
    geographicFocus,
  } = params;

  const allIssues = [...missingElements, ...formattingIssues];

  if (allIssues.length === 0) {
    return { html, appliedFixes: [], unchanged: true };
  }

  const contextHints: string[] = [];
  if (businessName) contextHints.push(`Business: ${businessName}`);
  if (persona) contextHints.push(`Persona/Tone: ${persona}`);
  if (geographicFocus) contextHints.push(`Location focus: ${geographicFocus}`);
  if (targetUrl) contextHints.push(`Primary URL for links: ${targetUrl}`);
  if (keywords.length > 0) contextHints.push(`Keywords to use for anchors: ${keywords.slice(0, 8).join(", ")}`);

  const faqMissing = allIssues.some(i => i.includes("MISSING_FAQ"));
  const imagesMissing = allIssues.some(i => i.includes("MISSING_IMAGES"));
  const linksMissing = allIssues.some(i => i.includes("MISSING_HYPERLINKS"));
  const markdownIssues = formattingIssues.filter(i => i.includes("markdown"));

  const issueInstructions = allIssues
    .map((issue, i) => `${i + 1}. ${issue}`)
    .join("\n");

  const faqGuidance = faqMissing
    ? `\nFor the FAQ section: Create a <h3>Frequently Asked Questions</h3> followed by a <dl> structure with <dt> for questions and <dd> for answers. Questions should relate to the article topic and${geographicFocus ? ` ${geographicFocus}` : ""}. Place it near the end of the article before any conclusion.`
    : "";

  const imageGuidance = imagesMissing
    ? `\nFor images: Insert <img> placeholders using: <img src="/placeholder.jpg" alt="[descriptive alt text related to article topic]" class="article-image" />. Place them after key section headings.`
    : "";

  const linkGuidance = linksMissing
    ? `\nFor hyperlinks: Wrap relevant keyword phrases in <a href="${targetUrl || "#"}"> tags. Use natural anchor text from the existing content — do not add new sentences. Maximum 1 link per keyword phrase.`
    : "";

  const markdownGuidance =
    markdownIssues.length > 0
      ? `\nFor markdown artifacts: Convert **text** to <strong>text</strong>, *text* to <em>text</em>, # Heading to <h2>Heading</h2>, and - item to <li>item</li> wrapped in <ul>.`
      : "";

  const systemPrompt = `You are a precise Senior HTML Content Editor. Your ONLY job is to surgically fix the specific issues listed — nothing else.

ABSOLUTE RULES:
1. DO NOT rewrite, rephrase, or restructure any existing sentences.
2. DO NOT change the tone, style, or persona.
3. DO NOT remove any existing content.
4. ONLY add or convert the specific missing elements listed in the issues.
5. Preserve all existing <div>, <section>, <article>, and <span> wrappers exactly.
6. Return the complete corrected HTML — nothing else. No explanation, no markdown code fences.
${contextHints.length > 0 ? `\nContent context:\n${contextHints.join("\n")}` : ""}`;

  const userPrompt = `Fix ONLY these specific issues in the article HTML below:

ISSUES TO FIX:
${issueInstructions}
${faqGuidance}${imageGuidance}${linkGuidance}${markdownGuidance}

CRITICAL: Preserve all existing text exactly. You are an editor inserting missing structural elements, not a writer.

EXISTING HTML:
${html}`;

  // Estimate required output tokens: the patched article must be at least as large
  // as the input HTML.  Using 16 k avoids the silent truncation that triggers the
  // 70 %-length guard and reverts the fix on long articles (> ~3 k words).
  const estimatedInputTokens = Math.ceil(html.length / 3.5); // ~3.5 chars/token for HTML
  const maxOutputTokens = Math.min(Math.max(estimatedInputTokens + 2000, 8000), 16000);

  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.15,
      max_tokens: maxOutputTokens,
    });

    const fixedHtml = response.choices[0]?.message?.content || html;
    const cleanedHtml = fixedHtml
      .replace(/^```html?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    if (cleanedHtml.length < html.length * 0.7) {
      console.warn("⚠️ Surgical fix returned suspiciously short output — keeping original");
      return { html, appliedFixes: [], unchanged: true };
    }

    const appliedFixes: string[] = [];
    if (faqMissing && cleanedHtml.toLowerCase().includes("frequently asked")) appliedFixes.push("FAQ section injected");
    if (imagesMissing && (cleanedHtml.match(/<img/gi) || []).length > (html.match(/<img/gi) || []).length) appliedFixes.push("Images added");
    if (linksMissing && (cleanedHtml.match(/<a\s/gi) || []).length > (html.match(/<a\s/gi) || []).length) appliedFixes.push("Hyperlinks added");
    if (markdownIssues.length > 0 && !cleanedHtml.includes("**")) appliedFixes.push("Markdown artifacts cleaned");

    return {
      html: cleanedHtml,
      appliedFixes,
      unchanged: appliedFixes.length === 0,
      tokenCount: response.usage?.total_tokens,
    };
  } catch (error) {
    console.error("❌ Surgical fix failed:", error);
    return { html, appliedFixes: [], unchanged: true };
  }
}
