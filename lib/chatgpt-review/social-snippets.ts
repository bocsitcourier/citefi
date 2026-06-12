import { openaiClient, callOpenAI } from "../openai-client";

export interface SocialSnippets {
  openGraph: {
    title: string; // 60-70 chars with emoji
    description: string; // 155-200 chars with emojis
    type: string; // "article"
  };
  twitter: {
    title: string; // 70-80 chars with emoji
    description: string; // 250-280 chars with emojis and 2-3 hashtags
    card: string; // "summary_large_image"
  };
  linkedin: {
    title: string; // 150-200 chars with emoji
    description: string; // 300-400 chars with emojis and 3-5 hashtags
  };
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function generateSocialSnippets(
  title: string,
  content: string,
  keywords: string[],
  geographicFocus?: string,
  // TASK 7: Enhanced local intelligence for snippets
  zipCodes?: string[],
  neighborhoods?: string[],
  authorityMarkers?: string[] // e.g., ["10+ years", "500+ clients", "Featured in SF Chronicle"]
): Promise<SocialSnippets> {
  const systemPrompt = `You are a viral social media copywriting expert who creates highly engaging, click-worthy snippets with LOCAL SEO optimization and authority signals.
Your mission: Create snippets that DEMAND attention, drive engagement, and signal local expertise.

Core principles:
1. Start with powerful hooks that create curiosity or urgency
2. Use 2-4 emojis strategically (beginning, middle, or end)
3. Include location-specific emojis when geographic focus provided (📍🌆🏙️)
4. Add relevant hashtags: Twitter (2-3), LinkedIn (3-5)
5. Use power words: "Ultimate", "Insider", "Secret", "Proven", "Essential"
6. Create FOMO with phrases like "Don't miss", "Revealed", "What nobody tells you"
7. Be conversational yet professional - write like a human, not a robot
8. MAX OUT character limits - longer = more engaging

TASK 7 ENHANCEMENTS - LOCAL SEO + AUTHORITY:
9. Weave in hyper-local markers (ZIP codes, neighborhoods) naturally when provided
10. Include authority signals (years of experience, client count, media features) to build credibility
11. Use answer-first framing where applicable (lead with value/insight)
12. Signal expertise through specific local references, not generic claims`;

  const userPrompt = `Article Title: ${title}
Keywords: ${keywords.join(", ")}
${geographicFocus ? `Location: ${geographicFocus}` : ""}
${zipCodes && zipCodes.length > 0 ? `ZIP Codes: ${zipCodes.slice(0, 2).join(', ')} (use in CTAs or local references)` : ""}
${neighborhoods && neighborhoods.length > 0 ? `Neighborhoods: ${neighborhoods.slice(0, 3).join(', ')} (mention for hyper-local appeal)` : ""}
${authorityMarkers && authorityMarkers.length > 0 ? `Authority Markers: ${authorityMarkers.slice(0, 3).join(', ')} (weave into descriptions)` : ""}

Content preview:
${content.slice(0, 1500)}

Create HIGHLY ENGAGING platform-specific snippets with LOCAL SEO optimization and authority signals that maximize engagement:

Return ONLY this JSON structure:
{
  "openGraph": {
    "title": "<60-70 chars with 1-2 emojis - make it compelling>",
    "description": "<155-200 chars with 2-3 emojis - create curiosity and urgency>",
    "type": "article"
  },
  "twitter": {
    "title": "<70-80 chars with 1-2 emojis - hook them instantly>",
    "description": "<250-280 chars with 2-3 emojis and 2-3 hashtags - conversational, engaging, creates FOMO>",
    "card": "summary_large_image"
  },
  "linkedin": {
    "title": "<150-200 chars with 1-2 emojis - professional but compelling>",
    "description": "<300-400 chars with 2-3 emojis and 3-5 hashtags - professional storytelling that drives clicks>"
  }
}

EXCELLENT Examples (TASK 7: with local SEO + authority):
- OG title: "🚀 The SEO Secret 94102 Businesses Use to Dominate Local Search"
- OG description: "💡 500+ Castro/Mission District businesses trust this proven strategy. 10+ years of SF SEO expertise reveal the exact local tactics that get 10x more customers. Featured in SF Chronicle. 📍"
- Twitter description: "📍 What if I told you there's a proven SEO strategy that 94102/94110 businesses use to get 300% more local customers? 10+ years serving SF neighborhoods. Real results. No BS. 🚀 #LocalSEO #SanFrancisco #94102"
- LinkedIn description: "💼 After analyzing 500+ San Francisco businesses across Castro, Mission, and SOMA neighborhoods, we discovered something surprising: The ones dominating local search aren't spending more on SEO—they're using hyper-local strategies in 94102, 94110, and 94103 ZIP codes. With 10+ years serving SF businesses and features in SF Chronicle, we break down the exact frameworks working RIGHT NOW. Real data from actual local businesses. 📊 #LocalSEO #SanFrancisco #DigitalMarketing #SmallBusiness #CastroDistrict"`;

  try {
    const completion = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: "json_object" },
      }),
      `Social Snippets: ${title.substring(0, 50)}`
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const snippets = JSON.parse(responseText);
    
    return {
      ...snippets,
      tokenUsage: {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
      },
    } as SocialSnippets;
  } catch (error) {
    console.error("Social snippet generation error:", error);
    throw new Error("Failed to generate social snippets");
  }
}
