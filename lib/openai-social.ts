import { openaiClient, callOpenAI } from "./openai-client";
import { 
  createBrandValidationPrompt, 
  getHashtagStrategy,
  normalizePlatform
} from "./social-prompt-guidance";

interface EnhanceSocialPostRequest {
  caption: string;
  platform: string;
  tone: string;
  userEmail: string;
  location?: string;
  topic?: string;
  industry?: string;
  landingPageUrl?: string;
  companyName?: string;
}

interface HashtagWithLink {
  tag: string;
  mailtoLink: string;
  type?: 'evergreen' | 'campaign';
}

interface EnhanceSocialPostResult {
  caption: string;
  hashtags: HashtagWithLink[];
  emojis: string[];
  hyperlinks: { text: string; url: string }[];
}

export async function enhanceSocialPostWithGPT(
  request: EnhanceSocialPostRequest
): Promise<EnhanceSocialPostResult> {
  const { caption, platform, tone, userEmail, location, topic, industry, landingPageUrl, companyName } = request;

  console.log(`✨ GPT-4 enhancing ${platform} post with SEO/GEO hashtags, emojis, and hyperlinks${companyName ? ` for ${companyName}` : ''}`);

  // Extract city and neighborhood from location
  const locationParts = location ? location.split(',').map(p => p.trim()) : [];
  const city = locationParts[0] || '';
  const neighborhood = locationParts[1] || '';

  // Get platform-specific hashtag strategy
  const hashtagStrategy = getHashtagStrategy(platform);
  const platformKey = normalizePlatform(platform);

  const prompt = `You are a social media and SEO expert. Enhance this social media post with strategic SEO-optimized and GEO-relevant hashtags, emojis, and hyperlinks.

${companyName ? createBrandValidationPrompt(companyName) + '\n' : ''}
PLATFORM: ${platform}
TONE: ${tone}
${location ? `LOCATION: ${location} (City: ${city}${neighborhood ? `, Neighborhood: ${neighborhood}` : ''})` : ''}
${topic ? `TOPIC: ${topic}` : ''}
${industry ? `INDUSTRY: ${industry}` : ''}
ORIGINAL CAPTION: ${caption}

HASHTAG STRATEGY FOR ${platform.toUpperCase()}:
- Total hashtags required: ${hashtagStrategy.total}
- Evergreen hashtags: ${hashtagStrategy.evergreenCount} (brand, geo, industry - long-term SEO value)
- Campaign-specific hashtags: ${hashtagStrategy.campaignCount} (topic, seasonal, trending - immediate reach)
- Strategy notes: ${hashtagStrategy.description}

CRITICAL REQUIREMENTS:
${companyName ? `0. **COMPANY NAME VALIDATION** - The correct spelling is "${companyName}" - scan the caption and fix ANY misspellings or abbreviations of this company name\n` : ''}
1. **${hashtagStrategy.total} HASHTAG MIX REQUIRED** - Generate EXACTLY ${hashtagStrategy.total} hashtags:
   
   EVERGREEN HASHTAGS (${hashtagStrategy.evergreenCount} required):
${location && city ? `   - GEO hashtags: #${city.replace(/\s+/g, '')}${neighborhood ? `, #${neighborhood.replace(/\s+/g, '')}` : ''}, #Local${city.replace(/\s+/g, '')}
   - INDUSTRY+GEO hashtags: #${city}${industry ? industry.replace(/\s+/g, '') : 'Business'}` : `   - INDUSTRY hashtags: #${industry ? industry.replace(/\s+/g, '') : 'Business'}`}
   - BRAND hashtags: ${companyName ? `#${companyName.replace(/\s+/g, '')}` : 'Not provided'}
   - These provide long-term SEO value and consistent brand presence
   
   CAMPAIGN-SPECIFIC HASHTAGS (${hashtagStrategy.campaignCount} required):
   - TOPIC hashtags: Related to ${topic || 'the post content'}
   - TRENDING hashtags: Current popular tags in ${industry || 'the industry'}
   - SEASONAL/TIMELY hashtags: If relevant to current events or season
   ${location && city ? `- COMPETITOR hashtags: Similar to high-ranking local ${industry || 'business'} competitors in ${city}` : `- COMPETITOR hashtags: Similar to high-ranking ${industry || 'business'} competitors`}
   - These maximize immediate reach and discovery
   
   - Auto-hyperlink ALL hashtags with mailto: links for tracking
   - Mix popular (10k+ uses) and niche (<5k uses) for balanced discovery
   ${!location ? '\n   NOTE: No location provided - focus on industry, topic, and brand hashtags (no geo tags needed)' : ''}

2. **Strategic Emojis (3-5)** - Select emojis that:
   - Match the ${tone} tone and ${industry || 'business'} industry
   - Are placed naturally within the caption (not clustered at end)
   - Enhance readability and emotional connection
   - Appropriate for ${platform} audience

3. **Internal Hyperlinks** - Create actionable hyperlinks:
   ${landingPageUrl ? `- Main CTA: "${landingPageUrl}" (your landing page)` : ''}
   - Email CTA: "mailto:${userEmail}?subject=Inquiry%20from%20${platform}"
   - Each hashtag gets mailto: link for tracking

RETURN FORMAT (JSON):
{
  "caption": "enhanced caption with emojis naturally placed",
  "hashtags": [
    ${location && city ? `{"tag": "#${city.replace(/\s+/g, '')}", "mailtoLink": "mailto:${userEmail}?subject=${encodeURIComponent(city)}%20Inquiry", "type": "evergreen"},\n    ` : ''}{"tag": "#${industry ? industry.replace(/\s+/g, '') : 'Business'}", "mailtoLink": "mailto:${userEmail}?subject=${encodeURIComponent(industry || 'Business')}%20Inquiry", "type": "evergreen"},
    {"tag": "#${topic || 'Trending'}", "mailtoLink": "mailto:${userEmail}?subject=${encodeURIComponent(topic || 'Trending')}%20Inquiry", "type": "campaign"}
  ],
  "emojis": ["🚀", "💡", "✨"],
  "hyperlinks": [
    {"text": "Learn more", "url": "${landingPageUrl || `mailto:${userEmail}`}"}
  ]
}

IMPORTANT:
- Generate EXACTLY ${hashtagStrategy.total} hashtags (${hashtagStrategy.evergreenCount} evergreen + ${hashtagStrategy.campaignCount} campaign)
- Tag each hashtag with "type": "evergreen" or "type": "campaign" in the JSON
${location && city ? `- MUST include location-based hashtags (${city}) in the evergreen set` : '- Focus on industry, brand, and topic hashtags (no location provided)'}
- Keep the core message unchanged (only add emojis)
- Emojis should enhance, not overwhelm (3-5 max)
- Hyperlinks should be subtle and natural
- Return ONLY valid JSON, nothing else
- If you return incorrect hashtag count, the response will be rejected`;

  const completion = await callOpenAI(
    (client) => client.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
    `Social Enhancement: ${platform} for ${companyName || userEmail}`
  );

  const responseText = completion.choices[0]?.message?.content || "{}";
  
  let result: EnhanceSocialPostResult;
  try {
    const parsed = JSON.parse(responseText);
    // Strip any AI-generated preamble artifacts that occasionally leak into caption fields
    // e.g. "Here is your post:", "Post:", "Social Post:", etc.
    const rawCaption: string = parsed.caption || caption;
    const cleanCaption = rawCaption.replace(/^(here is(?: your)?(?: (?:the|a|an))?(?: social)?(?: post|caption|update)?[:—\-]*\s*|post[:—\-]\s*|social post[:—\-]\s*)/i, '').trim();
    result = {
      caption: cleanCaption || caption,
      hashtags: parsed.hashtags || [],
      emojis: parsed.emojis || [],
      hyperlinks: parsed.hyperlinks || [],
    };
  } catch (error) {
    console.error("Failed to parse GPT response, using defaults:", error);
    result = {
      caption,
      hashtags: [
        { tag: "#Social", mailtoLink: `mailto:${userEmail}?subject=Social%20Inquiry`, type: 'campaign' },
        { tag: "#Content", mailtoLink: `mailto:${userEmail}?subject=Content%20Inquiry`, type: 'campaign' },
      ],
      emojis: [],
      hyperlinks: [],
    };
  }

  // DEFENSIVE CHECK: Enforce platform-specific hashtag requirement
  const expectedCount = hashtagStrategy.total;
  if (result.hashtags.length !== expectedCount) {
    if (result.hashtags.length < expectedCount) {
      console.warn(`⚠️ GPT returned only ${result.hashtags.length} hashtags (expected ${expectedCount} for ${platform}). Adding fallback hashtags.`);
    } else {
      console.warn(`⚠️ GPT returned ${result.hashtags.length} hashtags (expected ${expectedCount} for ${platform}). Truncating.`);
    }
    
    // Sanitize values for hashtags
    const sanitizedCity = city.replace(/\s+/g, '') || 'Local';
    const sanitizedIndustry = industry?.replace(/\s+/g, '') || 'Business';
    const sanitizedTopic = topic?.replace(/\s+/g, '') || 'Content';
    const sanitizedPlatform = platform.charAt(0).toUpperCase() + platform.slice(1);
    
    // Add fallback hashtags if we're under the expected count
    if (result.hashtags.length < expectedCount) {
      // Evergreen fallbacks (geo, brand, industry)
      const evergreenFallbacks = [
        { 
          tag: `#${sanitizedCity}`, 
          mailtoLink: `mailto:${userEmail}?subject=${encodeURIComponent(city || 'Local')}%20Inquiry`,
          type: 'evergreen' as const
        },
        { 
          tag: `#${sanitizedCity}${sanitizedIndustry}`, 
          mailtoLink: `mailto:${userEmail}?subject=${encodeURIComponent(city || 'Local')}%20${encodeURIComponent(industry || 'Business')}%20Inquiry`,
          type: 'evergreen' as const
        },
        { 
          tag: `#Local${sanitizedCity}`, 
          mailtoLink: `mailto:${userEmail}?subject=Local%20${encodeURIComponent(city || 'Area')}%20Inquiry`,
          type: 'evergreen' as const
        },
        { 
          tag: `#${sanitizedIndustry}`, 
          mailtoLink: `mailto:${userEmail}?subject=${encodeURIComponent(industry || 'Business')}%20Inquiry`,
          type: 'evergreen' as const
        },
        { 
          tag: `#LocalBusiness`, 
          mailtoLink: `mailto:${userEmail}?subject=Local%20Business%20Inquiry`,
          type: 'evergreen' as const
        },
      ];
      
      // Campaign fallbacks (topic, trending, platform-specific)
      const campaignFallbacks = [
        { 
          tag: `#${sanitizedTopic}`, 
          mailtoLink: `mailto:${userEmail}?subject=${encodeURIComponent(topic || 'Content')}%20Inquiry`,
          type: 'campaign' as const
        },
        { 
          tag: `#${sanitizedPlatform}Marketing`, 
          mailtoLink: `mailto:${userEmail}?subject=${sanitizedPlatform}%20Marketing%20Inquiry`,
          type: 'campaign' as const
        },
        { 
          tag: `#SocialMedia`, 
          mailtoLink: `mailto:${userEmail}?subject=Social%20Media%20Inquiry`,
          type: 'campaign' as const
        },
        {
          tag: `#SmallBusiness`,
          mailtoLink: `mailto:${userEmail}?subject=Small%20Business%20Inquiry`,
          type: 'campaign' as const
        },
        {
          tag: `#${sanitizedCity}${sanitizedPlatform}`,
          mailtoLink: `mailto:${userEmail}?subject=${encodeURIComponent(city || 'Local')}%20${sanitizedPlatform}%20Inquiry`,
          type: 'campaign' as const
        },
      ];
      
      // Mix evergreen and campaign fallbacks based on platform strategy
      const allFallbacks = [
        ...evergreenFallbacks,
        ...campaignFallbacks
      ].filter(h => !result.hashtags.find(existing => existing.tag === h.tag)); // Avoid duplicates
      
      // Add fallback hashtags until we reach the expected count
      const needed = expectedCount - result.hashtags.length;
      result.hashtags.push(...allFallbacks.slice(0, needed));
    }
    
    // ALWAYS cap at expected count (even after adding fallbacks)
    if (result.hashtags.length > expectedCount) {
      result.hashtags = result.hashtags.slice(0, expectedCount);
    }
  }

  console.log(`✅ GPT-4 enhanced with ${result.hashtags.length} hashtags, ${result.emojis.length} emojis`);

  return result;
}
