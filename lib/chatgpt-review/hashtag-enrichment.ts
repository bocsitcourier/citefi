import { openaiClient, callOpenAI } from "../openai-client";

export interface HashtagResult {
  hashtags: string[];
  categories: {
    seo: string[]; // SEO-focused hashtags
    geo: string[]; // Location-based hashtags
    brand: string[]; // Brand/industry hashtags
    trending: string[]; // Trending/popular hashtags
  };
  totalCount: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function generateHashtags(
  title: string,
  content: string,
  keywords: string[],
  geographicFocus?: string,
  industry?: string
): Promise<HashtagResult> {
  const systemPrompt = `You are a social media and SEO expert specializing in hashtag strategy.
Generate 10-20 highly relevant hashtags that combine:
1. SEO keywords (40%) - Core topic keywords
2. Geographic tags (30%) - Location-specific if provided
3. Brand/Industry tags (20%) - Industry and niche hashtags
4. Trending tags (10%) - Popular relevant hashtags

Hashtag rules:
- No spaces, use PascalCase for multi-word tags
- Mix of broad and niche tags
- Include both popular (#SEO) and long-tail (#LocalSEOSanFrancisco) tags
- Geo tags should include city, region, country where relevant
- Avoid overly generic tags like #content or #marketing`;

  const userPrompt = `Title: ${title}
Keywords: ${keywords.join(", ")}
${geographicFocus ? `Geographic Focus: ${geographicFocus}` : ""}
${industry ? `Industry: ${industry}` : ""}

Content preview:
${content.slice(0, 1000)}

Return ONLY this JSON structure:
{
  "hashtags": ["#Tag1", "#Tag2", ...],
  "categories": {
    "seo": ["#SEOTag1", "#SEOTag2", ...],
    "geo": ["#CityName", "#RegionName", ...],
    "brand": ["#IndustryTag1", ...],
    "trending": ["#TrendingTag1", ...]
  }
}

Generate 10-20 total hashtags.`;

  try {
    const completion = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-5.4-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 800,
        response_format: { type: "json_object" },
      }),
      `Hashtag Generator: ${title.substring(0, 50)}`
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(responseText);

    return {
      hashtags: parsed.hashtags || [],
      categories: parsed.categories || {
        seo: [],
        geo: [],
        brand: [],
        trending: [],
      },
      totalCount: parsed.hashtags?.length || 0,
      tokenUsage: {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
      },
    };
  } catch (error) {
    console.error("Hashtag generation error:", error);
    throw new Error("Failed to generate hashtags");
  }
}
