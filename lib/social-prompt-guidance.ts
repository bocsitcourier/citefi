/**
 * SOCIAL MEDIA PLATFORM PROMPT GUIDANCE
 * 
 * Based on Social Media Dashboard Prompt Strategy:
 * - Platform-specific voice, hooks, emotional triggers, and CTAs
 * - Brand consistency and validation
 * - Evergreen vs campaign-specific hashtag mix
 */

export interface PlatformGuidance {
  platform: string;
  hookFormula: string;
  emotionalTriggers: string[];
  ctaPattern: string[];
  targetAudience: string;
  brandVoiceElements: string[];
  dos: string[];
  donts: string[];
  hashtagStrategy: string;
}

export interface HashtagMix {
  evergreen: string[]; // Brand, geo, industry
  campaignSpecific: string[]; // Topic, seasonal, trends
}

/**
 * Platform-specific guidance for social media content creation
 */
export const PLATFORM_GUIDANCE: Record<string, PlatformGuidance> = {
  linkedin: {
    platform: "LinkedIn",
    hookFormula: "Professional insight, industry trend, or thought-leadership opening",
    emotionalTriggers: [
      "Trust and credibility",
      "Professional value and expertise", 
      "Career growth and opportunity",
      "Industry innovation and leadership"
    ],
    ctaPattern: [
      "Connect with us to learn more",
      "Visit our profile for insights",
      "Share your perspective in comments",
      "Message us to discuss further"
    ],
    targetAudience: "Decision-makers, professionals, business leaders, industry peers",
    brandVoiceElements: [
      "Professional and authoritative",
      "Data-driven and analytical",
      "Thought leadership positioning",
      "B2B relationship-building"
    ],
    dos: [
      "Lead with value proposition",
      "Use business storytelling",
      "Include credibility markers (stats, awards, expertise)",
      "Maintain professional tone throughout",
      "Tag relevant professionals"
    ],
    donts: [
      "Avoid overly casual language",
      "Don't use too many emojis",
      "Avoid hard selling",
      "Don't ignore B2B context"
    ],
    hashtagStrategy: "Professional industry terms, thought leadership topics, B2B keywords (3-5 hashtags typical)"
  },
  
  instagram: {
    platform: "Instagram",
    hookFormula: "Emotional story hook, relatable moment, or visual promise",
    emotionalTriggers: [
      "Authenticity and human connection",
      "Behind-the-scenes moments",
      "Visual storytelling and aesthetics",
      "Community and belonging"
    ],
    ctaPattern: [
      "Share your story in comments",
      "Tag someone who needs this",
      "Save this for later",
      "DM us to learn more",
      "Share to your story"
    ],
    targetAudience: "Visual-driven consumers, lifestyle enthusiasts, community seekers",
    brandVoiceElements: [
      "Warm and authentic",
      "Visually descriptive",
      "Uplifting and relatable",
      "Community-focused"
    ],
    dos: [
      "Use emotional storytelling",
      "Describe visual elements",
      "Build community engagement",
      "Show human side of brand",
      "Use relevant emojis naturally"
    ],
    donts: [
      "Avoid overly corporate language",
      "Don't be too text-heavy",
      "Avoid sales-first approach",
      "Don't ignore visual context"
    ],
    hashtagStrategy: "Mix of popular and niche, trending and evergreen, community and industry (15-30 hashtags typical)"
  },
  
  facebook: {
    platform: "Facebook",
    hookFormula: "Warm greeting, shared experience, or community connection",
    emotionalTriggers: [
      "Shared values and experiences",
      "Community support and belonging",
      "Family and relationships",
      "Local pride and connection"
    ],
    ctaPattern: [
      "Comment below with your thoughts",
      "Share with someone you love",
      "React if you agree",
      "Click to learn more",
      "Join our community"
    ],
    targetAudience: "Community members, families, local customers, diverse age groups",
    brandVoiceElements: [
      "Friendly and conversational",
      "Community-oriented",
      "Heartfelt and genuine",
      "Accessible and inclusive"
    ],
    dos: [
      "Tell success stories",
      "Use conversational tone",
      "Encourage comments and shares",
      "Highlight community impact",
      "Be personal and approachable"
    ],
    donts: [
      "Avoid being too formal",
      "Don't use complex jargon",
      "Avoid controversial topics",
      "Don't forget call-to-action"
    ],
    hashtagStrategy: "Community-focused, local area, cause-related, family-oriented (3-5 hashtags typical)"
  },
  
  x: {
    platform: "X (Twitter)",
    hookFormula: "Bold statement, provocative question, or breaking insight",
    emotionalTriggers: [
      "Urgency and timeliness",
      "Controversial or surprising facts",
      "Quick wins and actionable tips",
      "Industry news and trends"
    ],
    ctaPattern: [
      "Retweet if you agree",
      "Reply with your take",
      "Learn more [link]",
      "Follow for more insights",
      "What do you think?"
    ],
    targetAudience: "Fast-paced information seekers, industry influencers, news followers",
    brandVoiceElements: [
      "Concise and punchy",
      "Newsworthy and timely",
      "Conversational yet sharp",
      "Thread-friendly"
    ],
    dos: [
      "Be concise and direct",
      "Create conversation starters",
      "Use relevant hashtags (2-3)",
      "Engage with trending topics",
      "Make every word count"
    ],
    donts: [
      "Avoid being too wordy",
      "Don't waste opening hook",
      "Avoid hashtag stuffing",
      "Don't ignore character limit"
    ],
    hashtagStrategy: "Trending topics, timely events, industry keywords, campaign tags (2-3 hashtags typical)"
  },
  
  pinterest: {
    platform: "Pinterest",
    hookFormula: "Visual promise, aspirational outcome, or solution preview",
    emotionalTriggers: [
      "Inspiration and aspiration",
      "DIY and how-to appeal",
      "Visual transformation",
      "Problem-solving satisfaction"
    ],
    ctaPattern: [
      "Pin this for later",
      "Click to get started",
      "Save to your board",
      "Try this today",
      "Get the full guide"
    ],
    targetAudience: "Project planners, visual organizers, DIY enthusiasts, solution seekers",
    brandVoiceElements: [
      "Inspirational and helpful",
      "Action-oriented",
      "Visually descriptive",
      "Solution-focused"
    ],
    dos: [
      "Lead with transformation",
      "Focus on outcomes",
      "Use clear action steps",
      "Highlight visual appeal",
      "Include practical value"
    ],
    donts: [
      "Avoid vague descriptions",
      "Don't forget the 'how'",
      "Avoid overly corporate tone",
      "Don't ignore SEO keywords"
    ],
    hashtagStrategy: "How-to keywords, outcome-focused, inspiration themes, niche interests (5-10 hashtags typical)"
  }
};

/**
 * Shared brand validation prompt segment
 * Ensures company name appears exactly as written
 */
export function createBrandValidationPrompt(companyName: string): string {
  return `⚠️ BRAND VALIDATION RULE: The company name must appear exactly as written — ${companyName} — in all generated text. Do not alter, abbreviate, misspell, or create variations. Verify this exact name appears before final output.`;
}

/**
 * Normalize platform name to lowercase for consistent lookups
 * Exported for use across all social media generation modules
 * 
 * Handles common variations:
 * - LinkedIn/Linkedin → linkedin
 * - Instagram/IG → instagram
 * - Facebook/FB → facebook
 * - Twitter/X/X/Twitter → x
 * - Pinterest/Pin → pinterest
 */
export function normalizePlatform(platform?: string): string {
  if (!platform) return 'x';
  
  const normalized = platform.toLowerCase().trim();
  
  // Map all common variations to canonical platform keys
  const platformMap: Record<string, string> = {
    // LinkedIn variations
    'linkedin': 'linkedin',
    
    // Instagram variations
    'instagram': 'instagram',
    'ig': 'instagram',
    
    // Facebook variations
    'facebook': 'facebook',
    'fb': 'facebook',
    
    // X/Twitter variations
    'x': 'x',
    'twitter': 'x',
    'x/twitter': 'x',
    'twitter/x': 'x',
    
    // Pinterest variations
    'pinterest': 'pinterest',
    'pin': 'pinterest'
  };
  
  return platformMap[normalized] || 'x'; // Default to x if unknown
}

/**
 * Generate platform-specific content structure guidance
 */
export function getPlatformStructureGuidance(
  platform: string,
  contentSource: 'article' | 'standalone'
): string {
  const key = normalizePlatform(platform);
  const guidance = PLATFORM_GUIDANCE[key] || PLATFORM_GUIDANCE['x'];
  
  const articleContext = contentSource === 'article' 
    ? "Transform the article's main points into compelling social content that drives traffic back to the full article."
    : "Create engaging original content that sparks conversation and builds brand presence.";
  
  return `
POST STRUCTURE (${guidance.platform} optimized):
${articleContext}

- Opening (1-2 sentences): POWERFUL HOOK
  ${guidance.hookFormula}
  
- Body (2-3 sentences): EMOTIONAL RESONANCE  
  Connect with audience through: ${guidance.emotionalTriggers[0]}
  Provide value while maintaining ${guidance.brandVoiceElements[0]} voice
  
- Closing (1 sentence): CLEAR CALL-TO-ACTION
  ${guidance.ctaPattern[0]} or ${guidance.ctaPattern[1]}

DO:
${guidance.dos.slice(0, 3).map(item => `- ${item}`).join('\n')}

DON'T:
${guidance.donts.slice(0, 2).map(item => `- ${item}`).join('\n')}
`;
}

/**
 * Hashtag strategy generator
 * Returns mix of evergreen and campaign-specific hashtags
 */
export function getHashtagStrategy(platform: string): {
  total: number;
  evergreenCount: number;
  campaignCount: number;
  description: string;
} {
  const key = normalizePlatform(platform);
  const guidance = PLATFORM_GUIDANCE[key] || PLATFORM_GUIDANCE['x'];
  
  const strategyMap: Record<string, { total: number; evergreenRatio: number }> = {
    instagram: { total: 20, evergreenRatio: 0.4 }, // 8 evergreen, 12 campaign
    linkedin: { total: 5, evergreenRatio: 0.6 },   // 3 evergreen, 2 campaign
    facebook: { total: 5, evergreenRatio: 0.6 },   // 3 evergreen, 2 campaign
    x: { total: 3, evergreenRatio: 0.67 },         // 2 evergreen, 1 campaign
    pinterest: { total: 10, evergreenRatio: 0.5 }  // 5 evergreen, 5 campaign
  };
  
  const strategy = strategyMap[key] || strategyMap['x'];
  const evergreenCount = Math.round(strategy.total * strategy.evergreenRatio);
  const campaignCount = strategy.total - evergreenCount;
  
  return {
    total: strategy.total,
    evergreenCount,
    campaignCount,
    description: guidance.hashtagStrategy
  };
}

/**
 * Target audience definition
 */
export function getTargetAudience(
  platform: string,
  industry?: string
): string {
  const key = normalizePlatform(platform);
  const guidance = PLATFORM_GUIDANCE[key] || PLATFORM_GUIDANCE['x'];
  
  // Industry-specific audience refinement
  const industryAudience: Record<string, string> = {
    healthcare: "Patients, families, healthcare decision-makers",
    caregiving: "Families seeking quality care, elderly relatives, caregivers",
    legal: "Individuals needing legal services, business decision-makers",
    technology: "Tech enthusiasts, IT decision-makers, innovators",
    education: "Students, parents, educators, administrators",
    realestate: "Homebuyers, sellers, investors, property managers"
  };
  
  const specificAudience = industry ? industryAudience[industry.toLowerCase()] : null;
  
  return specificAudience || guidance.targetAudience;
}
