import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { socialPostAssets } from "@/shared/schema";
import { objectStorageClient } from "./storage";
import { createImageBrandLockPromptSegment } from "./branding";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required for image generation");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Type definitions for Gemini image response structure
interface GeminiImagePart {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
}

interface GeminiImageCandidate {
  content?: {
    parts?: GeminiImagePart[];
  };
}

interface GeminiImageResponse {
  candidates?: GeminiImageCandidate[];
}

/**
 * Type-safe helper to extract inline image data from Gemini response
 * The Gemini SDK runtime includes response.candidates but TypeScript types don't expose it
 * Checks both result.response.candidates (actual SDK path) and result.candidates (fallback)
 */
function extractInlineImageData(result: unknown): string | null {
  // Check if result has the expected shape
  if (!result || typeof result !== "object") {
    return null;
  }

  // Try to access nested response.candidates path (primary SDK path)
  const resultWithResponse = result as { response?: GeminiImageResponse };
  if (resultWithResponse.response?.candidates && Array.isArray(resultWithResponse.response.candidates)) {
    for (const candidate of resultWithResponse.response.candidates) {
      if (candidate.content?.parts && Array.isArray(candidate.content.parts)) {
        for (const part of candidate.content.parts) {
          if (part.inlineData?.data) {
            console.log(`  ✅ Found image data in result.response.candidates path`);
            return part.inlineData.data;
          }
        }
      }
    }
  }

  // Fallback: try top-level candidates
  const response = result as GeminiImageResponse;
  if (response.candidates && Array.isArray(response.candidates)) {
    for (const candidate of response.candidates) {
      if (candidate.content?.parts && Array.isArray(candidate.content.parts)) {
        for (const part of candidate.content.parts) {
          if (part.inlineData?.data) {
            console.log(`  ✅ Found image data in result.candidates path (fallback)`);
            return part.inlineData.data;
          }
        }
      }
    }
  }

  return null;
}

// Platform-specific aspect ratios and sizes
const ASPECT_RATIOS: Record<string, { ratio: string; description: string }> = {
  x: { ratio: "16:9", description: "16:9 landscape for X/Twitter" },
  facebook: { ratio: "1.91:1", description: "1.91:1 landscape for Facebook" },
  instagram: { ratio: "1:1", description: "1:1 square for Instagram" },
  linkedin: { ratio: "1.91:1", description: "1.91:1 landscape for LinkedIn" },
  pinterest: { ratio: "2:3", description: "2:3 vertical for Pinterest" },
};

interface GenerateSocialImagesRequest {
  socialPostId: number;
  prompt: string;
  platforms: string[];
  industry: string;
  companyName?: string;
}

interface ImageResult {
  platform: string;
  storageUrl: string;
  altText: string;
  aspectRatio: string;
}

export async function generateSocialImages(
  request: GenerateSocialImagesRequest
): Promise<ImageResult[]> {
  const { socialPostId, prompt, platforms, industry, companyName } = request;

  console.log(`🖼️ Generating images with Gemini for ${platforms.length} platforms${companyName ? ` for ${companyName}` : ''}`);

  const results: ImageResult[] = [];

  // Generate one image per platform with platform-specific aspect ratio
  for (const platform of platforms) {
    const aspectConfig = ASPECT_RATIOS[platform] ?? ASPECT_RATIOS['x'] ?? { ratio: '1:1', description: 'Square' };

    // Create image prompt optimized for social media
    const baseImagePrompt = `Create a professional, eye-catching social media image.
Theme: ${prompt}
Industry: ${industry}
${companyName ? `Company: ${companyName}` : ''}
Platform: ${platform} (${aspectConfig.description})
Style: Modern, clean, visually appealing, photorealistic
Requirements:
- High quality and professional
- Suitable for ${industry} industry
- Optimized for ${platform}
- Include relevant visual elements
- No text overlays needed unless company branding is essential
- Cinematic lighting and composition`;

    // Add centralized image brand lock if company name provided
    const imagePrompt = companyName 
      ? `${baseImagePrompt}\n\n${createImageBrandLockPromptSegment(companyName)}`
      : baseImagePrompt;

    try {
      console.log(`📸 Generating ${platform} image (${aspectConfig.ratio}) with Gemini...`);

      const result = await genAI.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: [{ role: "user", parts: [{ text: imagePrompt }] }],
        config: {
          responseModalities: ["Image"],
        },
      });

      // Extract image data using type-safe helper
      const imageData = extractInlineImageData(result);

      if (!imageData) {
        console.error(`❌ No image data in Gemini response for ${platform}`);
        console.error(`Response structure:`, JSON.stringify(result, null, 2));
        throw new Error(`No image data returned for ${platform} - check Gemini API response format`);
      }

      console.log(`  ✅ Image generated for ${platform}, uploading to permanent storage...`);

      // Convert base64 to buffer
      const imageBuffer = Buffer.from(imageData, "base64");

      // Upload to Replit Object Storage
      const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
      const timestamp = Date.now();
      const fileName = `social-${socialPostId}-${platform}-${timestamp}.png`;
      const objectPath = `public/social-media/${fileName}`;

      const bucket = objectStorageClient.bucket(BUCKET_ID);
      const file = bucket.file(objectPath);
      
      await file.save(imageBuffer, {
        contentType: "image/png",
        metadata: {
          cacheControl: "public, max-age=31536000",
        },
      });

      // Public URL served through Next.js API route
      const storageUrl = `/api/public-objects/social-media/${fileName}`;

      // Alt text for accessibility
      const altText = `${industry} social media image for ${platform}`;

      // Save to database
      await db.insert(socialPostAssets).values({
        socialPostId,
        platform,
        assetType: "image",
        promptUsed: imagePrompt.slice(0, 1000),
        storageUrl,
        altText,
        aspectRatio: aspectConfig.ratio,
        fileFormat: "png",
      });

      results.push({
        platform,
        storageUrl,
        altText,
        aspectRatio: aspectConfig.ratio,
      });

      console.log(`✅ Generated ${platform} image (${aspectConfig.ratio})`);
    } catch (error) {
      console.error(`❌ Failed to generate image for ${platform}:`, error);
      // Continue with other platforms even if one fails
    }
  }

  return results;
}
