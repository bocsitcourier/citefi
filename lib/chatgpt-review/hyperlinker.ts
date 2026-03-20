import { openaiClient, callOpenAI } from "../openai-client";
import { isHighQualityAnchor } from "../seo-policy";

export interface HyperlinkResult {
  keywords: Array<{
    phrase: string;
    url: string;
    type: "internal" | "external";
    anchorText: string;
  }>;
  totalLinks: number;
  internalCount: number;
  externalCount: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function generateHyperlinks(
  content: string,
  coreTopic: string,
  targetUrl: string,
  competitorUrls?: string[]
): Promise<HyperlinkResult> {
  const systemPrompt = `You are an SEO expert specializing in strategic hyperlink placement for local businesses.
Your task is to identify 15-20 high-quality semantic anchor phrases in the content that should ALL be hyperlinked to the client's website for maximum SEO value.

Rules:
- ALL links must point to ${targetUrl} (the client's website)
- Use EXACTLY 4-7 word phrases — this is a hard requirement (3 words or fewer are BANNED)
- Identify naturally occurring phrases that would be valuable anchor text
- CRITICAL: NEVER use a bare city or state name as anchor text ("Boston", "Boston MA", "Newton MA" are BANNED)
- CRITICAL: NEVER use location-only phrases — always pair a location with a service or action qualifier
- PREFERRED: Semantic cluster phrases describing services, benefits, or professional qualities
  ✅ "professional in-home memory care services"
  ✅ "compassionate post-hospital discharge assistance"
  ✅ "private caregiver support near Boston"
  ❌ "Boston MA" — city + state only (BANNED)
  ❌ "Newton MA" — bare city name (BANNED)
  ❌ "local care" — too short at 2 words (BANNED)
- Select phrases that match EXACTLY as they appear in the article (same capitalization, same word order)
- Prioritize phrases from THROUGHOUT the article: intro, body paragraphs, AND FAQ section
- Include at least 3-5 phrases from FAQ answers
- Avoid phrases starting or ending with stop words (the, a, an, in, on, at, to, for, of, and, or, but)
- Focus on phrases that potential customers would actually search for`;

  const userPrompt = `Core Topic: ${coreTopic}
Target URL (ALL hyperlinks must point here): ${targetUrl}
${competitorUrls?.length ? `Competitor URLs for reference: ${competitorUrls.join(", ")}` : ""}

Content to analyze:
${content}

Identify 15-20 semantic anchor phrases (EXACTLY 4-7 words each) that EXACTLY MATCH phrases in the content and would be valuable anchor text for hyperlinking to ${targetUrl}.

DISTRIBUTION REQUIREMENTS:
- 4-6 phrases from the INTRODUCTION (first 3 paragraphs)
- 6-10 phrases from the BODY paragraphs 
- 4-6 phrases from the FAQ SECTION (answers to questions)

PHRASE REQUIREMENTS:
- Each phrase MUST appear EXACTLY as written in the article (copy/paste from content)
- EXACTLY 4-7 words — this is a hard requirement
- NEVER use bare city or state names ("Boston", "Boston MA", "Newton MA" are BANNED)
- NEVER use location-only phrases — always service + location or benefit + location
- Prefer semantic clusters: "professional in-home memory care", "compassionate senior caregiver support"
- Avoid: "this article", "click here", "learn more", generic phrases
- Avoid phrases that start or end with: the, a, an, in, on, at, to, for, of, and, or, but

Return a JSON object with a "keywords" array:
{
  "keywords": [
    {
      "phrase": "EXACT phrase copied from article",
      "url": "${targetUrl}",
      "type": "internal",
      "anchorText": "EXACT phrase copied from article"
    }
  ]
}

CRITICAL: ALL links must have "url": "${targetUrl}" and "type": "internal". Return 20-30 total links with good distribution across intro, body, and FAQ.`;

  try {
    const completion = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2500,
        response_format: { type: "json_object" },
      }),
      `Hyperlinker: ${coreTopic.substring(0, 50)}`
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(responseText);
    
    // Defensive: coerce response into array (handles all OpenAI response formats)
    const rawKeywords = Array.isArray(parsed) 
      ? parsed 
      : Array.isArray(parsed.keywords) 
        ? parsed.keywords
        : Array.isArray(parsed.links) 
        ? parsed.links 
        : [];

    // PLATINUM: Post-parse quality gate — reject any anchor that violates SEO policy.
    // Bare city names ("Boston MA"), short phrases (<4 words), and stop-word-edged
    // phrases are stripped here so they never reach hyperlinkedKeywordsJson.
    let rejectedCount = 0;
    const keywords = rawKeywords.filter((k: any) => {
      const anchor = ((k.anchorText || k.phrase) || "").trim();
      if (!isHighQualityAnchor(anchor)) {
        console.warn(`[Hyperlinker] Rejected low-quality anchor "${anchor.slice(0, 60)}" — SEO policy`);
        rejectedCount++;
        return false;
      }
      return true;
    });
    if (rejectedCount > 0) {
      console.log(`[Hyperlinker] Quality gate: ${keywords.length} accepted, ${rejectedCount} rejected`);
    }

    const internalCount = keywords.filter((k: any) => k.type === "internal").length;
    const externalCount = keywords.filter((k: any) => k.type === "external").length;

    return {
      keywords,
      totalLinks: keywords.length,
      internalCount,
      externalCount,
      tokenUsage: {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
      },
    };
  } catch (error) {
    console.error("Hyperlink generation error:", error);
    throw new Error("Failed to generate hyperlinks");
  }
}
