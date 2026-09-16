import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { socialPostAssets } from "@/shared/schema";
import { objectStorageClient } from "./storage";
import { createImageBrandLockPromptSegment } from "./branding";
import { isProviderAccountingError, logFailedProviderAttempt, logCostTelemetry } from "./cost-telemetry";
import {
  canonicalizePlatform,
  getPlatformSpec,
  UnsupportedSocialPlatformError,
} from "./social-validation";
import { normalizeSocialImage } from "./social-image-normalizer";

export { normalizeSocialImage } from "./social-image-normalizer";
import { submitGeminiRequest } from "./gemini";
import { providerAttemptSourceEventIdForResponse } from "./provider-attempt-receipts";
import { allocateProviderAttemptIdentity } from "./provider-invocation-identity";

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

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

/**
 * Compatibility export for callers that need to inspect Gemini's native
 * request ratio. Values are derived from the canonical platform contract.
 */
export const NATIVE_GEMINI_IMAGE_ASPECT_RATIOS = Object.fromEntries(
  (["x", "facebook", "instagram", "linkedin", "pinterest"] as const).map((platform) => [
    platform,
    getPlatformSpec(platform).nativeAspectRatio,
  ]),
) as Record<string, string>;

interface GenerateSocialImagesRequest {
  socialPostId: number;
  teamId: number;
  prompt: string;
  platforms: string[];
  variantIds?: Record<string, number | undefined>;
  industry: string;
  companyName?: string;
  /** Logical route/job invocation identity; distinct regenerations must differ. */
  invocationKey?: string;
}

interface ImageResult {
  platform: string;
  storageUrl: string;
  altText: string;
  aspectRatio: string;
  fileFormat: string;
  width: number;
  height: number;
}

export async function generateSocialImages(
  request: GenerateSocialImagesRequest
): Promise<ImageResult[]> {
  if (!Number.isInteger(request.teamId) || request.teamId <= 0) {
    throw new Error("Gemini social image generation requires a validated teamId");
  }

  const { socialPostId, teamId, prompt, platforms, variantIds, industry, companyName } = request;
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is required for image generation");
  }
  const providerAttemptIdentity = allocateProviderAttemptIdentity({
    invocationKey: request.invocationKey,
    attemptKey: "social-image",
    provider: "gemini",
    operationType: "image_generation",
    model: "gemini-2.5-flash-image",
  });

  console.log(`🖼️ Generating images with Gemini for ${platforms.length} platforms${companyName ? ` for ${companyName}` : ''}`);

  const results: ImageResult[] = [];

  // Generate one image per platform with platform-specific aspect ratio
  for (const platform of platforms) {
    const canonicalPlatform = canonicalizePlatform(platform);
    if (!canonicalPlatform) throw new UnsupportedSocialPlatformError(platform);
    const platformSpec = getPlatformSpec(canonicalPlatform);
    const nativeAspectRatio = platformSpec.nativeAspectRatio;

    // Create image prompt optimized for social media
    const baseImagePrompt = `Create a professional, eye-catching social media image.
Theme: ${prompt}
Industry: ${industry}
${companyName ? `Company: ${companyName}` : ''}
    Platform: ${canonicalPlatform} (${platformSpec.imageDescription})
Style: Modern, clean, visually appealing, photorealistic
Requirements:
- High quality and professional
- Suitable for ${industry} industry
- Optimized for ${canonicalPlatform}
- Include relevant visual elements
- No text overlays needed unless company branding is essential
- Cinematic lighting and composition`;

    // Add centralized image brand lock if company name provided
    const imagePrompt = companyName 
      ? `${baseImagePrompt}\n\n${createImageBrandLockPromptSegment(companyName)}`
      : baseImagePrompt;

    const startedAt = Date.now();
    let providerSubmissionRecorded = false;
    try {
      console.log(`📸 Generating ${canonicalPlatform} image (${platformSpec.aspectRatio}) with Gemini...`);

      const generationRequest = {
        model: "gemini-2.5-flash-image",
        contents: [{ role: "user", parts: [{ text: imagePrompt }] }],
        config: {
          responseModalities: ["Image"],
          imageConfig: { aspectRatio: nativeAspectRatio },
        },
      };
      const result = await submitGeminiRequest(
        generationRequest,
        {
          teamId,
          operationType: "image_generation",
          resourceType: "social_post",
          resourceId: socialPostId,
          attempt: 1,
           invocationKey: providerAttemptIdentity.invocationKey,
           attemptKey: `${providerAttemptIdentity.attemptKey}:${canonicalPlatform}`,
        },
        () => genAI.models.generateContent(generationRequest),
      );
      await logCostTelemetry(
        {
          operationType: "image_generation", provider: "gemini", model: "gemini-2.5-flash-image",
          teamId,
          resourceType: "social_post", resourceId: socialPostId,
          providerRequestId: (result as any).responseId ?? null, attempt: 1,
           providerMetadata: { platform: canonicalPlatform, aspectRatio: platformSpec.aspectRatio },
        },
        {
          imageCount: 1,
          providerAttemptSourceEventId: providerAttemptSourceEventIdForResponse(result),
        },
        Date.now() - startedAt, true
      );
      providerSubmissionRecorded = true;

      // Extract image data using type-safe helper
      const imageData = extractInlineImageData(result);

      if (!imageData) {
        console.error(`❌ No image data in Gemini response for ${canonicalPlatform}`);
        console.error(`Response structure:`, JSON.stringify(result, null, 2));
        throw new Error(`No image data returned for ${canonicalPlatform} - check Gemini API response format`);
      }

      console.log(`  ✅ Image generated for ${canonicalPlatform}, uploading to permanent storage...`);

      // Convert base64 to buffer
      const imageBuffer = Buffer.from(imageData, "base64");
      const normalizedImage = await normalizeSocialImage(imageBuffer, canonicalPlatform);

      // Upload to Replit Object Storage
      const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
      const timestamp = Date.now();
      const fileName = `social-${socialPostId}-${canonicalPlatform}-${timestamp}.png`;
      const objectPath = `public/social-media/${fileName}`;

      const bucket = objectStorageClient.bucket(BUCKET_ID);
      const file = bucket.file(objectPath);
      
      await file.save(normalizedImage.imageBuffer, {
        contentType: normalizedImage.mimeType,
        metadata: {
          cacheControl: "public, max-age=31536000",
        },
      });

      // Public URL served through Next.js API route
      const storageUrl = `/api/public-objects/social-media/${fileName}`;

      // Alt text for accessibility
      const altText = `${industry} social media image for ${canonicalPlatform}`;

      // Save to database
      await db.insert(socialPostAssets).values({
        socialPostId,
        variantId: variantIds?.[canonicalPlatform] ?? null,
        platform: canonicalPlatform,
        assetType: "image",
        promptUsed: imagePrompt.slice(0, 1000),
        storageUrl,
        altText,
        aspectRatio: normalizedImage.aspectRatio,
        fileFormat: normalizedImage.fileFormat,
        width: normalizedImage.width,
        height: normalizedImage.height,
      });

      results.push({
        platform: canonicalPlatform,
        storageUrl,
        altText,
        aspectRatio: normalizedImage.aspectRatio,
        fileFormat: normalizedImage.fileFormat,
        width: normalizedImage.width,
        height: normalizedImage.height,
      });

      console.log(
        `✅ Generated ${canonicalPlatform} image (${normalizedImage.width}x${normalizedImage.height}, ${normalizedImage.fileFormat})`
      );
    } catch (error) {
      if (isProviderAccountingError(error)) throw error;
      // The request may have reached Gemini even when the SDK rejects. Do not
      // assign image units without a confirmed delivered image.
      if (!providerSubmissionRecorded) await logFailedProviderAttempt(
        {
          operationType: "image_generation", provider: "gemini", model: "gemini-2.5-flash-image",
          teamId,
          resourceType: "social_post", resourceId: socialPostId, attempt: 1,
          providerRequestId: `${socialPostId}:${platform}:1`,
           providerMetadata: { platform: canonicalPlatform, aspectRatio: platformSpec.aspectRatio },
        },
        { imageCount: 0 }, Date.now() - startedAt, error
      );
      console.error(`❌ Failed to generate image for ${canonicalPlatform}:`, error);
      // Continue with other platforms even if one fails
    }
  }

  return results;
}
