import { GEMINI_FLASH_MODEL } from "./ai-config";
import { GoogleGenAI } from "@google/genai";
import { 
  createBrandValidationPrompt, 
  getPlatformStructureGuidance, 
  getTargetAudience,
  PLATFORM_GUIDANCE,
  normalizePlatform
} from "./social-prompt-guidance";
import { 
  generateAdvancedSocialPrompt,
  type LocalIntelligence,
  type AuthoritySignals,
  type EEATSignals
} from "./social-prompt-guidance-advanced";
import { getContentOptimizationContext, type ContentOptimizationContext } from "./persona-content-integration";
import { humanizeSocialPost } from "./deterministic-humanizer";
import { validateContentWithFacts } from "./fact-validated-generators";
import { cleanGeneratedText } from "./content-cleaner";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required for Gemini social post generation");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface GeminiSocialPostRequest {
  prompt: string;
  platform: string;
  tone: string;
  mood: string;
  industry: string;
  characterLimit: number;
  location?: string;
  topic?: string;
  title?: string;
  companyName?: string;
  // TASK 7: Advanced Local SEO + Authority Signals
  localIntelligence?: LocalIntelligence;
  authoritySignals?: AuthoritySignals;
  eatSignals?: EEATSignals;
  useAdvancedPrompts?: boolean; // Flag to enable Task 7 enhancements
  // Psychographic targeting
  teamId?: number;
  personaId?: number;
  // Anti-Hallucination Framework
  enableFactValidation?: boolean;
  socialPostId?: number;
}

interface FactValidationResult {
  enabled: boolean;
  factCount: number;
  safetyScore?: number;
  validClaims?: number;
  rejectedClaims?: number;
}

interface GeminiSocialPostResult {
  caption: string;
  wordCount: number;
  characterCount: number;
  factValidation?: FactValidationResult;
  humanizationMetrics?: Record<string, unknown>;
}

export async function generateSocialPostWithGemini(
  request: GeminiSocialPostRequest
): Promise<GeminiSocialPostResult> {
  const { 
    prompt, 
    platform, 
    tone, 
    mood, 
    industry, 
    characterLimit, 
    location, 
    topic, 
    title, 
    companyName,
    localIntelligence,
    authoritySignals,
    eatSignals,
    useAdvancedPrompts = false, // TASK 7: Default to legacy prompts for backward compatibility
    teamId,
    personaId,
  } = request;

  console.log(`🤖 Gemini generating ${platform} post (${tone} tone, ${mood} mood${useAdvancedPrompts ? ' [ADVANCED LOCAL SEO]' : ''}${personaId ? ' [PERSONA TARGETED]' : ''})`);

  // TASK 7: Switch between legacy and advanced prompt systems
  let systemPrompt: string;

  if (useAdvancedPrompts) {
    // Use advanced local SEO + authority signal prompts
    const contentType: 'article' | 'standalone' | 'campaign' = title ? 'article' : 'standalone';
    systemPrompt = generateAdvancedSocialPrompt({
      platform,
      tone,
      mood,
      industry,
      basePrompt: prompt,
      companyName,
      localIntel: localIntelligence,
      authoritySignals,
      eatSignals,
      contentType,
    });
  } else {
    // LEGACY PROMPT SYSTEM (backward compatibility)
    // Extract city and neighborhood from location if possible
    const locationParts = location ? location.split(',').map(p => p.trim()) : [];
    const city = locationParts[0] || location || '';
    const neighborhood = locationParts[1] || '';

    // Get platform-specific guidance
    const platformKey = normalizePlatform(platform);
    const platformGuidance = (PLATFORM_GUIDANCE[platformKey] || PLATFORM_GUIDANCE['x'])!;
    const contentSource: 'article' | 'standalone' = title ? 'article' : 'standalone';
    const targetAudience = getTargetAudience(platform, industry);
    const structureGuidance = getPlatformStructureGuidance(platform, contentSource);

    systemPrompt = `You are the social media voice of ${companyName || 'this brand'}. Create a compelling ${platformGuidance.platform} post that drives engagement and builds trust with ${targetAudience}.

${companyName ? createBrandValidationPrompt(companyName) : ''}

PLATFORM CONTEXT:
- Platform: ${platformGuidance.platform}
- Brand Voice: ${tone} tone, ${mood} mood
- Industry: ${industry}
- Character Limit: ${characterLimit} characters (STRICT MAXIMUM)
- Target Audience: ${targetAudience}
${location ? `- Location: ${location} (City: ${city}${neighborhood ? `, Neighborhood: ${neighborhood}` : ''})` : ''}
${topic ? `- Topic: ${topic}` : ''}
${title ? `- Article Title: ${title}` : ''}

PLATFORM-SPECIFIC STRATEGY (${platformGuidance.platform}):
Hook Formula: ${platformGuidance.hookFormula}
Emotional Triggers: ${platformGuidance.emotionalTriggers.slice(0, 2).join(', ')}
Brand Voice: ${platformGuidance.brandVoiceElements.slice(0, 2).join(', ')}

CRITICAL REQUIREMENTS:
1. **POWERFUL OPENING HOOK** (First 1-2 sentences)
   - ${platformGuidance.hookFormula}
   - Grab attention immediately with ${platformGuidance.emotionalTriggers[0]}
   
2. **EMOTIONAL RESONANCE** (Middle 2-3 sentences)
   - Connect through: ${platformGuidance.emotionalTriggers[1] || platformGuidance.emotionalTriggers[0]}
   - Maintain ${platformGuidance.brandVoiceElements[0]} voice
   - ${location ? `Weave in ${city} references naturally (landmarks, neighborhoods, local culture)` : 'Provide relevant context'}
   
3. **CLEAR CALL-TO-ACTION** (Final sentence)
   - ${platformGuidance.ctaPattern[0]} or ${platformGuidance.ctaPattern[1]}
   - Make it specific and actionable
   
4. **PLATFORM OPTIMIZATION**:
   - Character limit: ${characterLimit} characters MAXIMUM (enforce strictly)
   - ${tone} tone throughout
   - ${platformGuidance.platform}-native language and style
   - NO hashtags (added separately)
   - NO emojis (added separately)
   ${companyName ? `- Include "${companyName}" exactly once (verify spelling)` : ''}

DO:
${platformGuidance.dos.slice(0, 3).map(item => `- ${item}`).join('\n')}

DON'T:
${platformGuidance.donts.slice(0, 2).map(item => `- ${item}`).join('\n')}

CONTENT PROMPT:
${prompt}

${structureGuidance}

Generate ONLY the post caption text. No explanations, no metadata, just the post itself.`;
  } // Close else block for legacy prompts

  // PSYCHOGRAPHIC TARGETING: Inject persona + learning context
  if (teamId) {
    try {
      const optimizationContext = await getContentOptimizationContext(teamId, "social", {
        personaId,
        industry,
      });
      
      if (optimizationContext.combinedSystemPrompt || optimizationContext.combinedUserPrompt) {
        console.log(`🧠 [PSYCHOGRAPHIC] Applying persona targeting for ${platform} social post`);
        systemPrompt += `\n\n**PSYCHOGRAPHIC TARGETING:**${optimizationContext.combinedSystemPrompt}${optimizationContext.combinedUserPrompt}`;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to fetch psychographic context for social:`, error);
    }
  }

  // Generate content with Gemini (shared by both prompt systems)
  const result = await genAI.models.generateContent({
    model: GEMINI_FLASH_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
    ],
  });
  
  // Strip any AI-generated trailing dots before checking length
  const caption = cleanGeneratedText((result.text || "").trim()) || "";
  
  // Defensive handling: ensure we have content
  if (!caption) {
    throw new Error(`Gemini returned empty response for ${platform} post`);
  }

  // Truncate to platform character limit at word boundary
  let truncatedCaption = caption;
  if (caption.length > characterLimit) {
    truncatedCaption = caption.substring(0, characterLimit);
    const lastSpace = truncatedCaption.lastIndexOf(" ");
    if (lastSpace > characterLimit * 0.8) truncatedCaption = truncatedCaption.substring(0, lastSpace);
    truncatedCaption = truncatedCaption.trim();
  }

  const wordCount = truncatedCaption.split(/\s+/).length;
  const characterCount = truncatedCaption.length;

  console.log(`✅ Gemini generated ${platform} post (${characterCount} chars, ${wordCount} words)`);

  let factValidation: FactValidationResult | undefined;

  if (request.enableFactValidation && request.teamId) {
    try {
      console.log(`🔍 [Anti-Hallucination] Starting fact validation for social post...`);
      
      const validationResult = await validateContentWithFacts(
        truncatedCaption,
        "social",
        {
          teamId: request.teamId,
          enableFactValidation: true,
          minConfidence: 70,
          topic: request.topic || request.title,
          contentId: request.socialPostId,
        }
      );

      factValidation = {
        enabled: true,
        factCount: validationResult.factPack.totalCount,
        safetyScore: validationResult.validationResult?.safetyScore,
        validClaims: validationResult.validationResult?.validatedClaims.length,
        rejectedClaims: validationResult.validationResult?.rejectedClaims.length,
      };

      console.log(`✅ [Anti-Hallucination] Social post validated. Safety: ${validationResult.validationResult?.safetyScore}%`);
    } catch (error) {
      console.warn('⚠️ Fact validation skipped for social post:', (error as Error).message);
      factValidation = { enabled: false, factCount: 0 };
    }
  }

  // DETERMINISTIC HUMANIZATION: Apply burstiness and scrub AI-isms
  const humanized = humanizeSocialPost(truncatedCaption, 0.35);
  
  // Re-calculate counts after humanization (DH may change length)
  const finalWordCount = humanized.content.split(/\s+/).filter(Boolean).length;
  const finalCharacterCount = humanized.content.length;
  
  console.log(`🔧 [DH] Social post humanized: burstiness=${humanized.metrics.burstinessApplied}, scrubs=${humanized.metrics.scrubsApplied}, chars=${finalCharacterCount}`);

  return {
    caption: humanized.content,
    wordCount: finalWordCount,
    characterCount: finalCharacterCount,
    factValidation,
    humanizationMetrics: humanized.metrics,
  };
}
