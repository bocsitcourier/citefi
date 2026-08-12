import { openaiClient, callOpenAI } from "../openai-client";

export interface EnhancedImagePrompt {
  original: string;
  enhanced: string;
  tags: string[];
  locationTags: string[];
  keywords: string[];
}

export interface ImageEnhancementResult {
  enhancedPrompts: EnhancedImagePrompt[];
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function enhanceImagePrompts(
  imagePrompts: string[],
  coreTopic: string,
  keywords: string[],
  geographicFocus?: string
): Promise<ImageEnhancementResult> {
  const systemPrompt = `You are an elite commercial photography director and DALL-E prompt engineer specializing in hyper-realistic, cinematic imagery.

Your expertise includes:
- Editorial photography (Vogue, National Geographic quality)
- Cinematic lighting and composition (Roger Deakins, Emmanuel Lubezki style)
- Location-specific authenticity and cultural accuracy
- Documentary-style realism with strategic staging
- Professional color grading and post-production aesthetics

Transform prompts into DALL-E masterpieces that look like they were shot by a $50,000/day commercial photographer.`;

  const userPrompt = `Core Topic: ${coreTopic}
SEO Keywords: ${keywords.join(", ")}
${geographicFocus ? `Geographic Location: ${geographicFocus}` : ""}

Original Image Prompts (already detailed):
${imagePrompts.map((p, i) => `${i + 1}. ${p}`).join("\n")}

ENHANCEMENT OBJECTIVES:

1. **Hyper-Specific Geo-Tagging**: 
   - Add architectural styles specific to ${geographicFocus || "the location"}
   - Include regional weather, seasons, or time-of-day context
   - Reference local landmarks, neighborhoods, or cultural elements
   - Example: "brownstone building in Back Bay, Boston" vs. "modern glass building in South Lake Union, Seattle"

2. **Cinematic Quality Specs**:
   - Camera model: "Shot on Canon EOS R5, RF 50mm f/1.2L lens"
   - Film stock aesthetic: "Kodak Portra 400 color palette" or "Fujifilm Pro 400H tones"
   - Resolution: "8K ultra-high resolution, RAW capture"
   - Post-production: "Professional color grading, Adobe Lightroom preset"

3. **Realistic Environmental Details**:
   - Weather conditions: "overcast Seattle sky" or "bright California sunshine"
   - Time context: "early morning golden hour" or "blue hour evening"
   - Seasonal markers: "autumn leaves visible" or "summer afternoon heat shimmer"
   - Atmospheric effects: "soft fog", "lens flare", "natural vignetting"

4. **Authentic Human Elements** (if people are in scene):
   - Specific demographics that match the target audience
   - Genuine emotions and micro-expressions
   - Natural body language and interactions
   - Realistic clothing brands and styles for the location
   - Example: "45-year-old Asian American woman, genuine laugh lines, wearing business casual (Everlane blouse)"

5. **Professional Photography Metadata**:
   - Exposure settings: "f/2.8, 1/125s, ISO 400"
   - Color temperature: "5500K daylight balanced"
   - Depth of field: "shallow DOF with bokeh background"
   - Focus point: "sharp focus on subject's eyes"

6. **Editorial Style References**:
   - Photography style: "Kinfolk magazine aesthetic" or "Apple commercial photography"
   - Mood boards: "Nordic minimalism" or "Warm industrial"
   - Influential photographers: "Annie Leibovitz portrait style" or "Peter McKinnon urban photography"

AVOID: Generic "professional", "high quality", "4K" tags without context
AIM FOR: Hyper-specific technical details that guide DALL-E to photorealistic excellence

Return ONLY this JSON structure:
{
  "enhancedPrompts": [
    {
      "original": "<original prompt>",
      "enhanced": "<massively enhanced 200+ character cinematic prompt>",
      "tags": ["<technical tag>", "<style tag>", ...],
      "locationTags": ["<geo tag>", ...],
      "keywords": ["<SEO keyword>", ...]
    }
  ]
}`;


  try {
    const completion = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 1500,
        response_format: { type: "json_object" },
      }),
      `Image Enhancer: ${coreTopic.substring(0, 50)}`
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(responseText);
    
    return {
      enhancedPrompts: parsed.enhancedPrompts || [],
      tokenUsage: {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
      },
    };
  } catch (error) {
    console.error("Image prompt enhancement error:", error);
    throw new Error("Failed to enhance image prompts");
  }
}
