import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface VideoSEOMetadataRequest {
  topic: string;
  title: string;
  location: string;
  companyName: string;
  industry: string;
  scriptHashtags: string[];
  landingPageUrl?: string | null;
}

export interface VideoSEOMetadata {
  videoTitle: string;
  videoDescription: string;
  videoTags: string[];
  videoHashtags: string[]; // Long-phrase hashtags hyperlinked to domain
}

/**
 * Generate SEO/GEO-optimized video metadata using GPT-4
 * 
 * Follows YouTube/TikTok SEO best practices:
 * - Title: Primary keyword + Location + Secondary keyword (max 100 chars)
 * - Description: Hook + Local service statement + Keywords + CTA + Hashtags
 * - Tags: 20-30 relevant tags combining SEO keywords, location terms, and industry
 */
export async function generateVideoSEOMetadata(
  request: VideoSEOMetadataRequest
): Promise<VideoSEOMetadata> {
  const { topic, title, location, companyName, industry, scriptHashtags, landingPageUrl } = request;

  console.log(`🏷️ Generating AI-powered SEO/GEO video metadata for: ${title}`);

  const prompt = `You are a video SEO expert specializing in local business marketing for YouTube, TikTok, and Instagram Reels.

BUSINESS CONTEXT:
Company: ${companyName}
Industry: ${industry}
Topic: ${topic}
Video Title (from script): ${title}
Location: ${location}
Landing Page: ${landingPageUrl || "N/A"}
Existing Hashtags: ${scriptHashtags.join(", ")}

GENERATE OPTIMIZED VIDEO METADATA:

1. VIDEO TITLE (max 100 characters):
Create a click-worthy, SEO-optimized title following this formula:
[Primary Keyword] - [Location] - [Benefit/Hook]

CRITICAL REQUIREMENTS:
- MUST use dashes WITHOUT spaces to separate title components (word-word-word format)
- NEVER use pipes (|) or colons (:)
- NEVER put spaces around dashes
- MUST ALWAYS include the location (${location}) - this is mandatory for local SEO
- Start with the most important keyword for search visibility
- Add a benefit or hook to increase click-through rate
- Keep under 100 characters (YouTube title limit)
- Include ${companyName} only if space allows

MANDATORY FORMAT (dashes with NO spaces):
- "In-Home-Care-Newton-MA-5-Tips-for-Families"
- "Senior-Care-Services-Newton-Massachusetts-Expert-Guide"
- "Best-${industry}-${location}-Complete-Family-Guide"

WRONG FORMAT (never use these):
- "In-Home Care | Newton MA | Tips" (NO PIPES)
- "In-Home Care - Newton MA - Tips" (NO SPACES AROUND DASHES)
- "Senior Care: Newton MA - Guide" (NO COLONS)

2. VIDEO DESCRIPTION (500-1000 characters):
Create a GEO-optimized description with:
- Opening hook (first 125 chars appear in search - make them count!)
- 2-3 sentences about the value/topic with location references
- E-E-A-T signal: Brief company credibility statement
- Clear call-to-action with landing page URL (if provided)
- DO NOT include hashtags in description (they go in separate field)

3. VIDEO TAGS (exactly 25 LONG-PHRASE keyword tags):
Generate 25 LONG-TAIL keyword phrases (4-8 words each) for SEO:
- 5 question-based long-tail keywords (e.g., "how to find reliable in home care services near me")
- 5 location-specific long phrases (e.g., "best senior care providers in Newton Massachusetts area")
- 5 problem-solution phrases (e.g., "affordable private caregiver options for elderly parents")
- 5 comparison/guide phrases (e.g., "complete guide to choosing home health aides")
- 5 intent-based phrases (e.g., "trusted in home care agencies accepting new clients")

4. VIDEO HASHTAGS (exactly 10 LONG-PHRASE hashtags):
Generate 10 long-phrase hashtags (3-6 words each, NO # symbol):
- Must be long descriptive phrases, NOT single words
- Include location in at least 3 hashtags
- Examples: "InHomeCareNewtonMA", "SeniorCareServicesBoston", "ElderlyCareTipsForFamilies"

CRITICAL RULES:
- Tags and hashtags should NOT include # symbols
- Tags should be lowercase, hashtags in PascalCase
- Tags must be 4-8 words (LONG PHRASES only)
- Hashtags must be 3-6 words combined into PascalCase
- Avoid generic single-word tags

OUTPUT FORMAT:
Return valid JSON only:
{
  "videoTitle": "SEO-optimized title under 100 chars",
  "videoDescription": "GEO-optimized description WITHOUT hashtags",
  "videoTags": ["long phrase keyword 1", "long phrase keyword 2", ... 25 long-tail phrases],
  "videoHashtags": ["LongPhraseHashtag1", "LongPhraseHashtag2", ... 10 PascalCase hashtags]
}

Return ONLY valid JSON. No markdown, no explanations.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const text = response.choices[0]?.message?.content?.trim() || "";
    
    // Clean markdown if present
    let cleanedText = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const result = JSON.parse(cleanedText);

    // Validate and enforce limits
    let videoTitle = (result.videoTitle || title).slice(0, 100);
    
    // CRITICAL: Enforce dash separators WITHOUT spaces
    // Replace pipes, colons, and spaced-dashes with plain dashes
    videoTitle = videoTitle
      .replace(/\s*\|\s*/g, "-")      // Replace pipes with dash
      .replace(/\s*:\s*/g, "-")       // Replace colons with dash
      .replace(/\s+-\s+/g, "-")       // Replace " - " with "-"
      .replace(/\s+/g, "-");          // Replace all spaces with dashes
    
    // CRITICAL: Ensure location is in title (mandatory for local SEO)
    const locationDashed = location.replace(/\s+/g, "-");
    if (!videoTitle.toLowerCase().includes(location.toLowerCase().replace(/\s+/g, "-"))) {
      // Append location if missing
      const locationSuffix = `-${locationDashed}`;
      if (videoTitle.length + locationSuffix.length <= 100) {
        videoTitle = videoTitle + locationSuffix;
      } else {
        // Truncate title to make room for location
        videoTitle = videoTitle.slice(0, 100 - locationSuffix.length) + locationSuffix;
      }
    }
    
    // Process tags - ensure long phrases
    const videoTags = Array.isArray(result.videoTags) 
      ? result.videoTags.slice(0, 30).map((t: string) => t.replace(/^#/, "").toLowerCase())
      : scriptHashtags.map(t => t.replace(/^#/, "").toLowerCase());
    
    // Process hashtags - long phrases in PascalCase
    let videoHashtags = Array.isArray(result.videoHashtags) 
      ? result.videoHashtags.slice(0, 10).map((h: string) => h.replace(/^#/, ""))
      : [];
    
    // If no hashtags generated, create from tags
    if (videoHashtags.length === 0 && videoTags.length > 0) {
      videoHashtags = videoTags.slice(0, 10).map((tag: string) => 
        tag.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join("")
      );
    }
    
    // Extract domain from landing page URL (no path, no protocol)
    let domain = "";
    if (landingPageUrl) {
      try {
        const urlObj = new URL(landingPageUrl.startsWith("http") ? landingPageUrl : `https://${landingPageUrl}`);
        domain = urlObj.hostname; // e.g., www.privateinhomecaregiver.com
      } catch {
        domain = landingPageUrl.replace(/^https?:\/\//, "").split("/")[0]!;
      }
    }
    
    // Build description with hyperlinked hashtags at the end
    let videoDescription = result.videoDescription || "";
    if (videoHashtags.length > 0 && domain) {
      const hashtagSection = videoHashtags
        .map((h: string) => `[#${h}](https://${domain})`)
        .join(" ");
      videoDescription = `${videoDescription}\n\n${hashtagSection}`;
    } else if (videoHashtags.length > 0) {
      const hashtagSection = videoHashtags.map((h: string) => `#${h}`).join(" ");
      videoDescription = `${videoDescription}\n\n${hashtagSection}`;
    }

    console.log(`✅ Generated SEO title: ${videoTitle}`);
    console.log(`✅ Generated ${videoTags.length} long-phrase tags`);
    console.log(`✅ Generated ${videoHashtags.length} hyperlinked hashtags`);

    return {
      videoTitle,
      videoDescription,
      videoTags,
      videoHashtags,
    };
  } catch (error) {
    console.error("❌ Video SEO metadata generation failed:", error);
    
    // Fallback to basic metadata (using dashes without spaces, location always included)
    const fallbackTitle = `${topic}-${location}-${companyName}`.replace(/\s+/g, "-").slice(0, 100);
    
    // Extract domain for fallback hashtags
    let fallbackDomain = "";
    if (landingPageUrl) {
      try {
        const urlObj = new URL(landingPageUrl.startsWith("http") ? landingPageUrl : `https://${landingPageUrl}`);
        fallbackDomain = urlObj.hostname;
      } catch {
        fallbackDomain = landingPageUrl.replace(/^https?:\/\//, "").split("/")[0]!;
      }
    }
    
    // Create fallback long-phrase hashtags
    const fallbackHashtags = [
      `${topic.replace(/\s+/g, "")}${location.replace(/\s+/g, "")}`,
      `${industry.replace(/\s+/g, "")}Services${location.replace(/\s+/g, "")}`,
      `Best${industry.replace(/\s+/g, "")}Near${location.replace(/\s+/g, "")}`,
    ];
    
    const hashtagSection = fallbackDomain 
      ? fallbackHashtags.map(h => `[#${h}](https://${fallbackDomain})`).join(" ")
      : fallbackHashtags.map(h => `#${h}`).join(" ");
    
    return {
      videoTitle: fallbackTitle,
      videoDescription: `Learn about ${topic} from ${companyName}, serving the ${location} community. ${landingPageUrl ? `Visit: ${fallbackDomain}` : ""}\n\n${hashtagSection}`,
      videoTags: scriptHashtags.map(t => t.replace(/^#/, "").toLowerCase()).slice(0, 25),
      videoHashtags: fallbackHashtags,
    };
  }
}
