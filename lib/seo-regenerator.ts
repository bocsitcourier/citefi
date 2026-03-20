import { GoogleGenAI } from "@google/genai";
import { cleanMetaDescription, cleanSeoTitle, cleanFaqAnswers } from "./content-cleaner";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ============================================================================
// INDIVIDUAL SEO FIELD REGENERATORS
// ============================================================================

export async function regenerateSeoTitle(
  currentTitle: string,
  articleContent: string
): Promise<string> {
  // Ensure articleContent is a valid string
  const safeContent = (articleContent || currentTitle || "").substring(0, 2000);
  
  const prompt = `You are an SEO title expert. Based on the article content below, generate ONE compelling SEO title that:
- Is 50-60 characters (max 70)
- Includes primary keyword naturally
- Creates urgency or curiosity
- Is more engaging than the current title

CURRENT TITLE: ${currentTitle}

ARTICLE CONTENT (first 500 words):
${safeContent}

Return ONLY the new SEO title, nothing else.`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  
  const responseText = result.text || "";
  const newTitle = cleanSeoTitle(responseText.trim());
  if (!newTitle || newTitle.length < 10) {
    throw new Error("Failed to generate valid SEO title");
  }
  return newTitle;
}

export async function regenerateMetaDescription(
  currentMeta: string,
  articleContent: string
): Promise<string> {
  // Ensure articleContent is a valid string
  const safeContent = (articleContent || currentMeta || "").substring(0, 2000);
  
  const prompt = `You are an SEO meta description expert. Based on the article content below, generate ONE compelling meta description that:
- Is 140-160 characters (max 160)
- Includes primary keyword
- Has a clear call-to-action or value proposition
- Is more engaging than the current meta description
- CRITICAL: Must be a COMPLETE sentence — NEVER end with "...", "…", or any truncation. Finish the thought within the character limit.

CURRENT META: ${currentMeta}

ARTICLE CONTENT (first 500 words):
${safeContent}

Return ONLY the new meta description, nothing else.`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  
  const responseText = result.text || "";
  const newMeta = cleanMetaDescription(responseText.trim());
  if (!newMeta || newMeta.length < 50) {
    throw new Error("Failed to generate valid meta description");
  }
  return newMeta;
}

export async function regenerateSlug(
  currentSlug: string,
  title: string
): Promise<string> {
  const prompt = `You are an SEO slug expert. Based on the title below, generate ONE URL-friendly slug that:
- Is lowercase with hyphens (no spaces, no special characters)
- Is 3-7 words maximum
- Includes primary keyword
- Is concise and descriptive

CURRENT SLUG: ${currentSlug}
TITLE: ${title}

Return ONLY the new slug (e.g., "best-seo-tips-2025"), nothing else.`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  
  const responseText = result.text || "";
  const rawSlug = responseText.trim();
  const newSlug = rawSlug
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  if (!newSlug || newSlug.length < 3) {
    throw new Error("Failed to generate valid slug");
  }
  return newSlug;
}

export async function regenerateKeywords(
  currentKeywords: string[],
  articleContent: string,
  articleTitle?: string
): Promise<string[]> {
  // Ensure articleContent is a valid string
  const safeContent = (articleContent || "").substring(0, 2000);
  
  const cityInstruction = articleTitle
    ? `\n- **PRIMARY CITY RULE**: The article title is "${articleTitle}". Identify the PRIMARY city/location from the title and make sure ALL 5 keywords include or clearly reference that primary city. Do NOT use neighboring cities or metro area names — only the primary city from the title.`
    : "";

  const prompt = `You are an SEO keyword expert. Based on the article content below, generate 5 LONG-PHRASE keywords (3-5 words each) that:
- Are natural language phrases people actually search
- Have high search intent
- Are different from current keywords
- Mix question-based and topic-based phrases${cityInstruction}

CURRENT KEYWORDS: ${currentKeywords.join(", ")}
${articleTitle ? `ARTICLE TITLE: ${articleTitle}` : ""}

ARTICLE CONTENT (first 500 words):
${safeContent}

Return ONLY 5 keywords as a JSON array, nothing else.
Example format: ["home care Wellesley MA", "post-rehab caregivers Wellesley", "trusted home health near Wellesley MA", "senior care services Wellesley MA", "rehabilitation support Wellesley MA"]`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  
  const responseText = result.text || "";
  const rawText = responseText.trim();
  
  // Extract JSON array from response
  const jsonMatch = rawText.match(/\[.*\]/s);
  if (jsonMatch) {
    const keywords = JSON.parse(jsonMatch[0]);
    return keywords.slice(0, 5);
  }
  
  throw new Error("Failed to generate keywords");
}

export async function regenerateHashtags(
  currentHashtags: string[],
  articleContent: string,
  geographicFocus?: string
): Promise<string[]> {
  // Ensure articleContent is a valid string
  const safeContent = (articleContent || "").substring(0, 2000);
  const geoContext = geographicFocus ? `\nGEOGRAPHIC FOCUS: ${geographicFocus}` : '';

  const prompt = `You are a social media hashtag expert. Based on the article content below, generate 10-15 hashtags that:
- Mix SEO, geographic, brand, and trending tags
- Are relevant to the content
- Include location-specific tags if geographic focus is provided
- Are different from current hashtags
- Use proper hashtag format (#LowerCamelCase)

CURRENT HASHTAGS: ${currentHashtags.join(", ")}${geoContext}

ARTICLE CONTENT (first 500 words):
${safeContent}

Return ONLY hashtags as a JSON array, nothing else.
Example format: ["#SEO", "#ContentMarketing", "#DigitalMarketing", "#SEOTips", "#MarketingStrategy"]`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  
  const responseText = result.text || "";
  const rawText = responseText.trim();
  
  // Extract JSON array from response
  const jsonMatch = rawText.match(/\[.*\]/s);
  if (jsonMatch) {
    const hashtags = JSON.parse(jsonMatch[0]);
    return hashtags.slice(0, 15);
  }
  
  throw new Error("Failed to generate hashtags");
}

export async function regenerateFAQ(
  currentFaq: Array<{ question: string; answer: string }>,
  articleContent: string
): Promise<Array<{ question: string; answer: string }>> {
  // Ensure articleContent is a valid string
  const safeContent = (articleContent || "").substring(0, 2000);
  
  const prompt = `You are an FAQ expert. Based on the article content below, generate 5-8 FAQ items that:
- Address common questions related to the topic
- Have concise, helpful answers (50-100 words each)
- Are different from current FAQ items
- Cover different aspects of the topic
- CRITICAL: Every answer MUST be a complete sentence ending with a period. NEVER end with "...", "…", or trailing dots of any kind.

CURRENT FAQ:
${currentFaq.map((item, i) => `Q${i + 1}: ${item.question}\nA${i + 1}: ${item.answer}`).join('\n\n')}

ARTICLE CONTENT (first 500 words):
${safeContent}

Return ONLY a JSON array of FAQ objects with "question" and "answer" fields, nothing else.
Example format: [{"question": "What is SEO?", "answer": "SEO stands for Search Engine Optimization and helps websites rank higher in search results."}]`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  
  const responseText = result.text || "";
  const rawText = responseText.trim();
  
  // Extract JSON array from response
  const jsonMatch = rawText.match(/\[.*\]/s);
  if (jsonMatch) {
    const faq = JSON.parse(jsonMatch[0]);
    return cleanFaqAnswers(faq.slice(0, 8));
  }
  
  throw new Error("Failed to generate FAQ");
}
