import { GoogleGenAI } from "@google/genai";
import { throttledGeminiRequest } from "./gemini";
import { createBrandLockPromptSegment } from "./branding";
import { getContentOptimizationContext, type ContentOptimizationContext } from "./persona-content-integration";
import { validateContentWithFacts } from "./fact-validated-generators";
import { humanizePodcastScript } from "./deterministic-humanizer";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface PodcastScript {
  title: string;
  duration: string;
  segments: Array<{
    speaker: 'host1' | 'host2';
    voice: 'female' | 'male';
    text: string;
  }>;
}

export async function generatePodcastScript(
  articleTitle: string,
  articleContent: string,
  options: {
    tone?: string;
    duration?: string;
    industry?: string;
    companyName?: string;
    teamId?: number;
    personaId?: number;
    enableFactValidation?: boolean;
    podcastId?: number;
  } = {}
): Promise<PodcastScript> {
  const {
    tone = "friendly, informative, and professional",
    duration = "3-4 minutes",
    industry = "business",
    companyName = "our company",
    teamId,
    personaId,
    enableFactValidation,
    podcastId,
  } = options;
  
  const brandLockContext = companyName && companyName !== "our company" ? createBrandLockPromptSegment(companyName) : "";
  
  // PSYCHOGRAPHIC TARGETING: Fetch persona + learning context
  let personaContext = "";
  if (teamId) {
    try {
      const optimizationContext = await getContentOptimizationContext(teamId, "podcast", {
        personaId,
        industry,
      });
      
      if (optimizationContext.combinedSystemPrompt || optimizationContext.combinedUserPrompt) {
        console.log(`🧠 [PSYCHOGRAPHIC] Applying persona targeting for podcast script`);
        personaContext = `\n\n**PSYCHOGRAPHIC TARGETING:**${optimizationContext.combinedSystemPrompt}${optimizationContext.combinedUserPrompt}`;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to fetch psychographic context for podcast:`, error);
    }
  }

  const prompt = `You are an expert podcast script writer. Create a natural, engaging, ENTERTAINING 2-host conversational podcast script that summarizes the following article.${personaContext}

**Article Title:** ${articleTitle}

**Article Content:** 
${articleContent.substring(0, 4000)}
${brandLockContext}

**Requirements:**
- Duration: ${duration}
- Tone: ${tone}
- Industry: ${industry}
- Two hosts: Host 1 (Female voice - warm, enthusiastic, storyteller) and Host 2 (Male voice - insightful, witty, asks great questions)

**CRITICAL STRUCTURE - MUST FOLLOW:**

1. **VALUE PROPOSITION INTRO (First 2-3 segments):**
   - Host 1 welcomes listeners and explains what this podcast series is about
   - What value do listeners gain from this podcast? (insights, tips, actionable advice)
   - Make it inviting and clear why someone should keep listening

2. **EPISODE-SPECIFIC HOOK (Next 2-4 segments):**
   - Tease the topic of THIS episode with intrigue
   - Use a compelling hook: relatable story, surprising fact, thought-provoking question, or scenario
   - Example: "Have you ever wondered why...?" or "Picture this scenario..." or "Here's something that surprised me..."
   - Build curiosity - make them WANT to hear more

3. **MAIN CONTENT (Core discussion with 5-8 talking points):**
   - Use REAL-WORLD EXAMPLES and STORIES to illustrate points
   - Share relatable scenarios listeners can connect with
   - Include light humor, witty observations, occasional laughter cues like "[laughs]" or "Ha!" 
   - React authentically: "Wow, that's fascinating!" "I never thought of it that way!" "That's a game-changer!"
   - Ask thought-provoking questions between hosts
   - Use analogies and metaphors to make complex ideas simple
   - Share mini case studies or "imagine if" scenarios

4. **ENGAGING CONVERSATION ELEMENTS:**
   - Natural banter and chemistry between hosts
   - Friendly disagreements or different perspectives
   - Personal anecdotes: "I actually tried this once..." or "This reminds me of..."
   - Playful teasing or jokes (keep it professional but fun)
   - Build on each other's points: "Oh! And building on that..." "That's exactly right, and here's why..."
   - Use conversational fillers naturally: "you know", "right?", "exactly!", "for sure"

5. **CONCLUSION (Final 2-3 segments):**
   - Summarize key takeaways
   - End with a strong call-to-action that EXPLICITLY mentions "${companyName}"
   - Example CTAs: "Visit ${companyName} to learn more", "Contact ${companyName} today", "Check out ${companyName}'s services"
   - Make the CTA natural and conversational, not salesy
   - Invite listeners to take action with ${companyName}

**Format your response as JSON:**
{
  "title": "Catchy episode title that hooks interest",
  "duration": "estimated duration",
  "segments": [
    {"speaker": "host1", "voice": "female", "text": "Host 1's dialogue"},
    {"speaker": "host2", "voice": "male", "text": "Host 2's dialogue"},
    ...
  ]
}

**STYLE GUIDELINES:**
- Make it feel like two friends having an interesting conversation over coffee
- Use storytelling: paint pictures with words, use "imagine", "picture this", "here's what happened"
- Include emotion: enthusiasm, surprise, excitement, curiosity
- Vary sentence length and pacing for dynamic delivery
- Each segment should be a complete thought, under 100 words
- Create moments where listeners will smile, think, or have an "aha!" moment

Make this podcast MEMORABLE and ENJOYABLE, not just informative!`;

  try {
    const result = await throttledGeminiRequest(() => genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    }));
    const text = (result.text || "").trim();
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to extract JSON from Gemini response");
    }
    
    const script: PodcastScript = JSON.parse(jsonMatch[0]);
    
    if (!script.segments || script.segments.length === 0) {
      throw new Error("Generated script has no segments");
    }

    // DETERMINISTIC HUMANIZATION: Apply burstiness and scrub AI-isms to segment text
    for (let i = 0; i < script.segments.length; i++) {
      const humanized = humanizePodcastScript(script.segments[i].text, 0.50);
      script.segments[i].text = humanized.content;
    }
    console.log(`🔧 [DH] Podcast script humanized: ${script.segments.length} segments processed`);

    if (enableFactValidation && teamId) {
      try {
        console.log(`🔍 [Anti-Hallucination] Starting fact validation for podcast script...`);
        
        const scriptContent = script.segments.map(s => s.text).join('\n');
        const validationResult = await validateContentWithFacts(
          scriptContent,
          "podcast",
          {
            teamId,
            enableFactValidation: true,
            minConfidence: 70,
            topic: articleTitle,
            contentId: podcastId,
          }
        );

        console.log(`✅ [Anti-Hallucination] Podcast script validated. Safety: ${validationResult.validationResult?.safetyScore}%, Facts: ${validationResult.factPack.totalCount}`);
      } catch (error) {
        console.warn('⚠️ Fact validation skipped for podcast script:', (error as Error).message);
      }
    }
    
    return script;
  } catch (error) {
    console.error("Error generating podcast script:", error);
    throw new Error(`Podcast script generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
