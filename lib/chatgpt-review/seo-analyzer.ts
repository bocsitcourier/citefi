import { openaiClient, callOpenAI } from "../openai-client";

export interface SEOAnalysis {
  seoScore: number; // 0-100
  keywordDensity: {
    primary: number;
    secondary: number;
    overOptimized: boolean;
  };
  readability: {
    fleschScore: number; // 0-100 (higher = easier)
    gradeLevel: string;
    avgSentenceLength: number;
  };
  localSignals: {
    napMentions: number; // Name, Address, Phone mentions
    locationKeywords: number;
    geoRelevance: number; // 0-100
  };
  recommendations: string[];
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function analyzeSEO(
  content: string,
  title: string,
  metaDescription: string,
  keywords: string[],
  geographicFocus?: string,
  businessName?: string
): Promise<SEOAnalysis> {
  const systemPrompt = `You are an advanced SEO analyzer with expertise in local SEO and content optimization.
Analyze content for:
1. Keyword density (target: 1-2% for primary, avoid keyword stuffing)
2. Readability (Flesch Reading Ease score)
3. Local SEO signals (NAP data, location mentions)
4. Overall SEO quality score (0-100)

Provide actionable recommendations for improvement.`;

  const userPrompt = `Title: ${title}
Meta Description: ${metaDescription}
Target Keywords: ${keywords.join(", ")}
${geographicFocus ? `Geographic Focus: ${geographicFocus}` : ""}
${businessName ? `Business Name: ${businessName}` : ""}

Content to analyze:
${content.slice(0, 4000)}

Return ONLY this JSON structure:
{
  "seoScore": <0-100>,
  "keywordDensity": {
    "primary": <percentage as decimal>,
    "secondary": <percentage as decimal>,
    "overOptimized": <boolean>
  },
  "readability": {
    "fleschScore": <0-100>,
    "gradeLevel": "<grade level>",
    "avgSentenceLength": <number>
  },
  "localSignals": {
    "napMentions": <count>,
    "locationKeywords": <count>,
    "geoRelevance": <0-100>
  },
  "recommendations": ["<recommendation 1>", "<recommendation 2>", "..."]
}`;

  try {
    const completion = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 1000,
        response_format: { type: "json_object" },
      }),
      `SEO Analyzer: ${title.substring(0, 50)}`
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const analysis = JSON.parse(responseText);
    
    return {
      ...analysis,
      tokenUsage: {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
      },
    } as SEOAnalysis;
  } catch (error) {
    console.error("SEO analysis error:", error);
    throw new Error("Failed to analyze SEO");
  }
}
