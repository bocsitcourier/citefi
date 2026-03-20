/**
 * TASK 7: ADVANCED LOCAL SEO SOCIAL MEDIA PROMPT GUIDANCE
 * 
 * Enhanced platform-specific prompts with:
 * - Deep local intelligence (ZIP codes, neighborhoods, landmarks)
 * - Authority signals (local experts, organizations, credentials)
 * - E-E-A-T alignment for social content
 * - Answer-first hooks for AI citation optimization
 * 
 * Based on Lily Ray + Mike King + Kevin Indig methodologies
 */

import { normalizePlatform, PLATFORM_GUIDANCE } from "./social-prompt-guidance";

export interface LocalIntelligence {
  city?: string;
  state?: string;
  zipCodes?: string[];
  neighborhoods?: string[];
  landmarks?: string[];
  localEvents?: string[];
  demographics?: {
    ageRange?: string;
    incomeLevel?: string;
    targetMarket?: string;
  };
}

export interface AuthoritySignals {
  localExperts?: Array<{
    name: string;
    credentials: string;
    affiliation?: string;
  }>;
  localOrganizations?: Array<{
    name: string;
    relationship: string; // "partner", "member", "certified_by"
  }>;
  credentials?: string[]; // ["BBB A+", "10+ years in SF", "500+ local clients"]
  mediaFeatures?: string[]; // ["SF Chronicle", "ABC7 News"]
  awards?: string[];
  testimonialHighlights?: Array<{
    quote: string;
    author: string;
    location: string;
  }>;
}

export interface EEATSignals {
  experience: {
    yearsInMarket?: number;
    localCaseCount?: number;
    specializations?: string[];
  };
  expertise: {
    certifications?: string[];
    industryRecognition?: string[];
    thoughtLeadership?: string[];
  };
  authoritativeness: {
    mediaAppearances?: string[];
    speakingEngagements?: string[];
    industryAssociations?: string[];
  };
  trustworthiness: {
    reviewRating?: number;
    reviewCount?: number;
    guarantees?: string[];
    transparencyMarkers?: string[];
  };
}

/**
 * Generate advanced local SEO social prompt with authority signals
 */
export function generateAdvancedSocialPrompt(params: {
  platform: string;
  tone: string;
  mood: string;
  industry: string;
  basePrompt: string;
  companyName?: string;
  localIntel?: LocalIntelligence;
  authoritySignals?: AuthoritySignals;
  eatSignals?: EEATSignals;
  contentType: 'article' | 'standalone' | 'campaign';
}): string {
  const {
    platform,
    tone,
    mood,
    industry,
    basePrompt,
    companyName,
    localIntel,
    authoritySignals,
    eatSignals,
    contentType,
  } = params;

  const platformKey = normalizePlatform(platform);
  const guidance = (PLATFORM_GUIDANCE[platformKey] || PLATFORM_GUIDANCE['x'])!;

  // Build local intelligence context
  const localContext = buildLocalContext(localIntel);
  const authorityContext = buildAuthorityContext(authoritySignals);
  const eatContext = buildEEATContext(eatSignals);
  const answerFirstGuidance = getAnswerFirstGuidance(platformKey, contentType);

  return `You are an advanced local SEO social media strategist creating ${guidance.platform} content that maximizes AI citation potential and local engagement.

${companyName ? `BRAND: ${companyName}` : ''}
PLATFORM: ${guidance.platform}
TONE: ${tone} | MOOD: ${mood}
INDUSTRY: ${industry}

${localContext}

${authorityContext}

${eatContext}

${answerFirstGuidance}

PLATFORM STRATEGY (${guidance.platform}):
Hook Formula: ${guidance.hookFormula}
Target Audience: ${guidance.targetAudience}
Emotional Triggers: ${guidance.emotionalTriggers.slice(0, 3).join(', ')}
Brand Voice: ${guidance.brandVoiceElements.slice(0, 2).join(', ')}

CRITICAL REQUIREMENTS FOR LOCAL SEO + AUTHORITY:

1. **ANSWER-FIRST OPENING** (First sentence/hook):
   ${getAnswerFirstTemplate(platformKey)}
   - Lead with immediate value or insight
   - Include location if relevant to answer
   - Set up authority positioning

2. **LOCAL INTELLIGENCE INTEGRATION** (Throughout post):
   ${getLocalIntegrationGuidance(localIntel, platformKey)}

3. **AUTHORITY SIGNAL PLACEMENT** (Middle section):
   ${getAuthorityPlacementGuidance(authoritySignals, platformKey)}

4. **E-E-A-T DEMONSTRATION** (Woven naturally):
   ${getEEATDemonstrationGuidance(eatSignals, platformKey)}

5. **PLATFORM-OPTIMIZED CTA** (Closing):
   ${guidance.ctaPattern[0]} or ${guidance.ctaPattern[1]}
   ${localIntel?.zipCodes ? `- Consider location-specific CTAs: "Serving ${localIntel.zipCodes[0]} and surrounding areas"` : ''}

DO (Platform-Specific + Local SEO):
${guidance.dos.slice(0, 2).map(item => `- ${item}`).join('\n')}
- Mention specific neighborhoods/ZIP codes naturally
- Reference local landmarks when relevant
- Include authority markers (credentials, awards, local experts)
- Demonstrate local expertise through specifics

DON'T:
${guidance.donts.slice(0, 2).map(item => `- ${item}`).join('\n')}
- Don't use generic "local business" language
- Avoid vague authority claims without specifics
- Don't force location mentions if unnatural

CONTENT PROMPT:
${basePrompt}

Generate ONLY the post caption. No hashtags (added separately), no emojis (added separately), no explanations. Just the compelling, locally-optimized, authority-driven post.`;
}

/**
 * Build local intelligence context section
 */
function buildLocalContext(localIntel?: LocalIntelligence): string {
  if (!localIntel) return '';

  const parts: string[] = ['LOCAL INTELLIGENCE MANDATE:'];
  
  if (localIntel.city) {
    parts.push(`- Primary Location: ${localIntel.city}${localIntel.state ? `, ${localIntel.state}` : ''}`);
  }
  
  if (localIntel.neighborhoods && localIntel.neighborhoods.length > 0) {
    parts.push(`- Neighborhoods: ${localIntel.neighborhoods.slice(0, 3).join(', ')}`);
    parts.push(`  → Mention specific neighborhoods to signal hyper-local expertise`);
  }
  
  if (localIntel.zipCodes && localIntel.zipCodes.length > 0) {
    parts.push(`- ZIP Codes: ${localIntel.zipCodes.slice(0, 3).join(', ')}`);
    parts.push(`  → Include ZIP references in CTAs for local SEO boost`);
  }
  
  if (localIntel.landmarks && localIntel.landmarks.length > 0) {
    parts.push(`- Local Landmarks: ${localIntel.landmarks.slice(0, 3).join(', ')}`);
    parts.push(`  → Reference landmarks to establish geographic credibility`);
  }
  
  if (localIntel.demographics?.targetMarket) {
    parts.push(`- Target Demographic: ${localIntel.demographics.targetMarket}`);
  }

  return parts.join('\n');
}

/**
 * Build authority signals context section
 */
function buildAuthorityContext(authoritySignals?: AuthoritySignals): string {
  if (!authoritySignals) return '';

  const parts: string[] = ['AUTHORITY SIGNALS (Weave Naturally):'];
  
  if (authoritySignals.credentials && authoritySignals.credentials.length > 0) {
    parts.push(`- Credentials: ${authoritySignals.credentials.slice(0, 3).join(', ')}`);
  }
  
  if (authoritySignals.localExperts && authoritySignals.localExperts.length > 0) {
    const experts = authoritySignals.localExperts.slice(0, 2);
    parts.push(`- Local Expert Citations Available:`);
    experts.forEach(expert => {
      parts.push(`  → ${expert.name}, ${expert.credentials}${expert.affiliation ? ` (${expert.affiliation})` : ''}`);
    });
  }
  
  if (authoritySignals.localOrganizations && authoritySignals.localOrganizations.length > 0) {
    const orgs = authoritySignals.localOrganizations.slice(0, 2);
    parts.push(`- Local Partnerships: ${orgs.map(o => o.name).join(', ')}`);
  }
  
  if (authoritySignals.awards && authoritySignals.awards.length > 0) {
    parts.push(`- Awards/Recognition: ${authoritySignals.awards.slice(0, 2).join(', ')}`);
  }
  
  if (authoritySignals.testimonialHighlights && authoritySignals.testimonialHighlights.length > 0) {
    const testimonial = authoritySignals.testimonialHighlights[0]!;
    parts.push(`- Featured Testimonial: "${testimonial.quote}" - ${testimonial.author}, ${testimonial.location}`);
  }

  return parts.join('\n');
}

/**
 * Build E-E-A-T signals context section
 */
function buildEEATContext(eatSignals?: EEATSignals): string {
  if (!eatSignals) return '';

  const parts: string[] = ['E-E-A-T DEMONSTRATION OPPORTUNITIES:'];
  
  // Experience
  if (eatSignals.experience.yearsInMarket) {
    parts.push(`- Experience: ${eatSignals.experience.yearsInMarket}+ years in market`);
  }
  if (eatSignals.experience.localCaseCount) {
    parts.push(`  → ${eatSignals.experience.localCaseCount}+ local cases/clients served`);
  }
  
  // Expertise
  if (eatSignals.expertise.certifications && eatSignals.expertise.certifications.length > 0) {
    parts.push(`- Expertise: ${eatSignals.expertise.certifications.slice(0, 2).join(', ')}`);
  }
  
  // Authoritativeness
  if (eatSignals.authoritativeness.mediaAppearances && eatSignals.authoritativeness.mediaAppearances.length > 0) {
    parts.push(`- Media: Featured in ${eatSignals.authoritativeness.mediaAppearances.slice(0, 2).join(', ')}`);
  }
  
  // Trustworthiness
  if (eatSignals.trustworthiness.reviewRating && eatSignals.trustworthiness.reviewCount) {
    parts.push(`- Trust: ${eatSignals.trustworthiness.reviewRating}/5 stars (${eatSignals.trustworthiness.reviewCount} reviews)`);
  }

  return parts.join('\n');
}

/**
 * Get platform-specific answer-first guidance
 */
function getAnswerFirstGuidance(platform: string, contentType: string): string {
  const answerFirstMap: Record<string, string> = {
    linkedin: `ANSWER-FIRST FRAMEWORK (LinkedIn Professional):
- Lead with the key insight, answer, or finding
- First sentence = Direct value statement
- Example: "After analyzing 500 SF businesses, we found [specific insight]..."
- Then provide context and supporting evidence`,
    
    x: `ANSWER-FIRST FRAMEWORK (X/Twitter):
- Immediate value in first 10 words
- Skip the setup, deliver the payoff
- Example: "[Specific fact/insight] + [why it matters]"
- Create urgency or surprise in opening`,
    
    instagram: `STORY-FIRST FRAMEWORK (Instagram):
- Open with relatable local moment or visual hook
- Answer emerges through authentic storytelling
- Example: "Walking through [neighborhood], we noticed..."
- Blend answer into emotional narrative`,
    
    facebook: `COMMUNITY-FIRST FRAMEWORK (Facebook):
- Warm, conversational opening
- Answer framed as shared discovery
- Example: "Many of our [city] neighbors ask us..."
- Build trust through familiarity`,
    
    pinterest: `SOLUTION-FIRST FRAMEWORK (Pinterest):
- Lead with transformation promise
- Answer = the outcome they'll achieve
- Example: "How [neighborhood] homeowners are achieving..."
- Focus on actionable results`,
  };

  return (answerFirstMap[platform] ?? answerFirstMap['x'])!;
}

/**
 * Get answer-first template for specific platform
 */
function getAnswerFirstTemplate(platform: string): string {
  const templates: Record<string, string> = {
    linkedin: 'Professional insight or data-driven finding that answers implied question',
    x: 'Bold statement or surprising fact (10-15 words max)',
    instagram: 'Relatable story opening that hints at the answer',
    facebook: 'Warm question or shared experience that sets up answer',
    pinterest: 'Transformation promise or outcome statement',
  };

  return (templates[platform] ?? templates['x'])!;
}

/**
 * Get local intelligence integration guidance
 */
function getLocalIntegrationGuidance(localIntel?: LocalIntelligence, platform?: string): string {
  if (!localIntel) {
    return '- Use general location references if available\n- Demonstrate local knowledge when possible';
  }

  const guidance: string[] = [];

  if (localIntel.neighborhoods && localIntel.neighborhoods.length > 0) {
    guidance.push(`- Mention "${localIntel.neighborhoods[0]}" neighborhood to establish hyper-local relevance`);
  }

  if (localIntel.zipCodes && localIntel.zipCodes.length > 0) {
    guidance.push(`- Include "${localIntel.zipCodes[0]}" ZIP code in CTA or service area mention`);
  }

  if (localIntel.landmarks && localIntel.landmarks.length > 0) {
    guidance.push(`- Reference "${localIntel.landmarks[0]}" landmark to signal local presence`);
  }

  if (localIntel.demographics?.targetMarket) {
    guidance.push(`- Address "${localIntel.demographics.targetMarket}" demographic specifically`);
  }

  return guidance.length > 0 ? guidance.join('\n') : '- Use location context where natural';
}

/**
 * Get authority signal placement guidance
 */
function getAuthorityPlacementGuidance(authoritySignals?: AuthoritySignals, platform?: string): string {
  if (!authoritySignals) {
    return '- Establish credibility through professional voice\n- Reference expertise where relevant';
  }

  const guidance: string[] = [];

  if (authoritySignals.credentials && authoritySignals.credentials.length > 0) {
    guidance.push(`- Weave in: "${authoritySignals.credentials[0]}" naturally`);
  }

  if (authoritySignals.localExperts && authoritySignals.localExperts.length > 0) {
    const expert = authoritySignals.localExperts[0]!;
    guidance.push(`- Consider citing: "${expert.name}, ${expert.credentials}" for added authority`);
  }

  if (authoritySignals.localOrganizations && authoritySignals.localOrganizations.length > 0) {
    guidance.push(`- Mention partnership: "${authoritySignals.localOrganizations[0]!.name}"`);
  }

  return guidance.length > 0 ? guidance.join('\n') : '- Build credibility through specific examples';
}

/**
 * Get E-E-A-T demonstration guidance
 */
function getEEATDemonstrationGuidance(eatSignals?: EEATSignals, platform?: string): string {
  if (!eatSignals) {
    return '- Demonstrate expertise through specific insights\n- Build trust through transparency';
  }

  const guidance: string[] = [];

  if (eatSignals.experience.yearsInMarket) {
    guidance.push(`- Signal experience: "${eatSignals.experience.yearsInMarket}+ years" serving area`);
  }

  if (eatSignals.trustworthiness.reviewRating && eatSignals.trustworthiness.reviewCount) {
    guidance.push(`- Show social proof: "${eatSignals.trustworthiness.reviewRating}/5 (${eatSignals.trustworthiness.reviewCount} reviews)"`);
  }

  if (eatSignals.authoritativeness.mediaAppearances && eatSignals.authoritativeness.mediaAppearances.length > 0) {
    guidance.push(`- Mention media coverage: "Featured in ${eatSignals.authoritativeness.mediaAppearances[0]}"`);
  }

  return guidance.length > 0 ? guidance.join('\n') : '- Demonstrate authority through track record';
}
