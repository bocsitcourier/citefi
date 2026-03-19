import { matchTopicToPages } from "./site-crawler";
import { callOpenAI } from "./openai-client";

export interface AnchorMapping {
  phrase: string;
  url: string;
  pageTitle: string;
}

export interface ContextualAnchorResult {
  anchors: AnchorMapping[];
  fallbackUrl: string;
  usedSiteMap: boolean;
}

export async function generateContextualAnchors(
  articleHtml: string,
  articleTopic: string,
  teamId: number,
  targetUrl: string,
  businessName: string
): Promise<ContextualAnchorResult> {
  const domain = extractDomainFromUrl(targetUrl);
  const matchedPages = await matchTopicToPages(teamId, articleTopic, domain, 10);

  if (matchedPages.length === 0) {
    console.log(`📎 No site map pages found for ${domain} - using single-URL fallback`);
    return { anchors: [], fallbackUrl: targetUrl, usedSiteMap: false };
  }

  console.log(`📎 Found ${matchedPages.length} matching site pages for topic "${articleTopic}"`);

  const plainText = articleHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  const pagesContext = matchedPages.map((p, i) =>
    `Page ${i + 1}: URL: ${p.url}\n  Title: ${p.title}\n  Summary: ${p.contentSummary.substring(0, 200)}`
  ).join("\n\n");

  const systemPrompt = `You are an SEO anchor text specialist. You analyze article content and match phrases to specific destination pages on the client's website. Each phrase must link to the MOST RELEVANT page, not just one URL.`;

  const userPrompt = `Analyze this article and assign anchor text phrases to the most relevant destination pages.

BUSINESS: ${businessName}
ARTICLE TOPIC: ${articleTopic}

AVAILABLE DESTINATION PAGES:
${pagesContext}

FALLBACK URL (for phrases that don't match any page above): ${targetUrl}

ARTICLE TEXT:
${plainText.substring(0, 6000)}

INSTRUCTIONS:
1. Find 20-30 long-phrase keywords (4-8 words) that EXIST VERBATIM in the article
2. For each phrase, assign it to the MOST RELEVANT destination page from the list above
3. Match by topic relevance: service phrases → service pages, location phrases → location pages, etc.
4. If a phrase doesn't clearly match any page, assign it to the fallback URL
5. Distribute links across multiple pages - don't send everything to one page
6. Phrases MUST appear EXACTLY as written in the article text

OUTPUT JSON:
{
  "anchors": [
    {"phrase": "exact phrase from article", "url": "https://matching-page-url.com/page", "pageTitle": "Page Title"},
    ...
  ]
}

RULES:
- Every phrase MUST exist verbatim in the article text above
- Each phrase 4-8 words long
- Use URLs ONLY from the destination pages list or fallback URL
- Distribute across at least 3 different URLs when possible
- 60% service/solution phrases, 40% location/authority phrases`;

  try {
    const completion = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 3000,
        response_format: { type: "json_object" },
      }),
      `Contextual Anchor Generation: ${articleTopic.substring(0, 40)}`,
      120000
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(responseText);

    const rawAnchors: AnchorMapping[] = Array.isArray(parsed.anchors)
      ? parsed.anchors.filter((a: any) => a.phrase && a.url && a.phrase.split(" ").length >= 3)
      : [];

    const validatedAnchors = rawAnchors.filter(anchor => {
      return plainText.toLowerCase().includes(anchor.phrase.toLowerCase());
    });

    const urlDistribution = new Map<string, number>();
    for (const a of validatedAnchors) {
      urlDistribution.set(a.url, (urlDistribution.get(a.url) || 0) + 1);
    }
    console.log(`📎 Generated ${validatedAnchors.length} contextual anchors across ${urlDistribution.size} URLs`);

    return {
      anchors: validatedAnchors,
      fallbackUrl: targetUrl,
      usedSiteMap: true,
    };
  } catch (error) {
    console.error("❌ Contextual anchor generation error:", error);
    return { anchors: [], fallbackUrl: targetUrl, usedSiteMap: false };
  }
}

function extractDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
