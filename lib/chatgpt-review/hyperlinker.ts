import { openaiClient, callOpenAI } from "../openai-client";

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
Your task is to identify 20-30 long-phrase keywords in the content that should ALL be hyperlinked to the client's website for maximum SEO value and traffic generation.

Rules:
- ALL links must point to ${targetUrl} (the client's website)
- Use long-phrase keywords (3-7 words) not single words
- Identify naturally occurring phrases that would be valuable anchor text
- CRITICAL: 60% of phrases MUST include service-related words like: services, solutions, help, care, support, assistance, delivery, courier, provider, professional, expert, specialist, company, business, team
- CRITICAL: 40% of phrases MUST include location words: city names, neighborhoods, "local", "near me", "in [location]"
- Select phrases that match EXACTLY as they appear in the article (same capitalization, same word order)
- Prioritize phrases from THROUGHOUT the article: intro, body paragraphs, AND FAQ section
- Include at least 3-5 phrases from FAQ answers
- Avoid generic phrases like "this article" or "click here"
- Focus on phrases that potential customers would actually search for`;

  const userPrompt = `Core Topic: ${coreTopic}
Target URL (ALL hyperlinks must point here): ${targetUrl}
${competitorUrls?.length ? `Competitor URLs for reference: ${competitorUrls.join(", ")}` : ""}

Content to analyze:
${content}

Identify 20-30 long-phrase keywords (3-7 words each) that EXACTLY MATCH phrases in the content and would be valuable anchor text for hyperlinking to ${targetUrl}.

DISTRIBUTION REQUIREMENTS:
- 5-7 phrases from the INTRODUCTION (first 3 paragraphs)
- 8-12 phrases from the BODY paragraphs 
- 5-8 phrases from the FAQ SECTION (answers to questions)

PHRASE REQUIREMENTS:
- Each phrase MUST appear EXACTLY as written in the article (copy/paste from content)
- 60% must include service words: services, solutions, help, care, support, delivery, courier, professional, expert, provider, specialist
- 40% must include location words: city names, neighborhoods, "local", "in [city]"
- Use 3-7 word phrases, NOT single words
- Avoid: "this article", "click here", "learn more", generic phrases

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
    const keywords = Array.isArray(parsed) 
      ? parsed 
      : Array.isArray(parsed.keywords) 
        ? parsed.keywords
        : Array.isArray(parsed.links) 
        ? parsed.links 
        : [];

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
