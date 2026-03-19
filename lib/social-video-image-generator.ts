import { GoogleGenAI } from "@google/genai";
import { objectStorageClient } from "./storage";
import type { VideoScene } from "./gemini-video-script-generator";
import { createImageBrandLockPromptSegment } from "./branding";
import sharp from "sharp";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required for image generation");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface VideoImageResult {
  sceneNumber: number;
  storageUrl: string;
  localPath: string;
  aspectRatio: string;
}

interface GenerateVideoImagesRequest {
  socialPostId: number;
  scenes: VideoScene[];
  industry: string;
  companyName: string;
  platform: string; // Determines aspect ratio
  landingPageUrl?: string; // For Scene 5 to show exact website URL
}

const PLATFORM_ASPECT_RATIOS: Record<string, string> = {
  instagram: "16:9",
  facebook: "16:9",
  linkedin: "16:9",
  x: "16:9",
  twitter: "16:9",
  pinterest: "16:9",
  default: "16:9", // Landscape for all platforms
};

// Platform-specific dimensions for image generation
const PLATFORM_DIMENSIONS: Record<string, { width: number; height: number }> = {
  instagram: { width: 1920, height: 1080 }, // 16:9 horizontal
  facebook: { width: 1920, height: 1080 }, // 16:9 horizontal
  linkedin: { width: 1920, height: 1080 }, // 16:9 horizontal
  x: { width: 1920, height: 1080 }, // 16:9 horizontal
  twitter: { width: 1920, height: 1080 }, // 16:9 horizontal
  pinterest: { width: 1920, height: 1080 }, // 16:9 horizontal
  default: { width: 1920, height: 1080 }, // Landscape 16:9
};

export async function generateVideoImages(
  request: GenerateVideoImagesRequest
): Promise<VideoImageResult[]> {
  const { socialPostId, scenes, industry, companyName, platform, landingPageUrl } = request;

  console.log(`🖼️ Generating 5 images in parallel for 60-second video (${platform} format)`);

  const aspectRatio = PLATFORM_ASPECT_RATIOS[platform] || PLATFORM_ASPECT_RATIOS.default;
  const dimensions = PLATFORM_DIMENSIONS[platform] || PLATFORM_DIMENSIONS.default;
  const { width: targetWidth, height: targetHeight } = dimensions;
  
  console.log(`  📐 Target dimensions: ${targetWidth}x${targetHeight} (${aspectRatio})`);


  // Prepare temp directory once
  const fs = await import("fs/promises");
  const path = await import("path");
  const tempDir = "/tmp/video-images";
  await fs.mkdir(tempDir, { recursive: true });

  // Generate all 5 images concurrently (PERFORMANCE BOOST: ~5x faster)
  const imagePromises = scenes.map(async (scene) => {
    // CRITICAL: DO NOT ask Gemini to render URL text
    // URLs will be added via FFmpeg text overlay to prevent hallucination
    // Gemini only generates the background image for Scene 5
    const scene5Instructions = scene.sceneNumber === 5 
      ? `\n\nSCENE 5 REQUIREMENTS:
- Create a beautiful, serene professional background scene
- Use soft, calming colors with elegant lighting (golden hour, soft gradients, bokeh)
- Show a pleasant environment scene (office interior, nature view, cityscape, abstract patterns)
- Leave the lower portion relatively uncluttered for text overlay
- Ensure good contrast for readable text overlay
- This is an allowed background image - generate a visually appealing scene` 
      : '';

    const baseImagePrompt = `Create a professional, cinematic image for a business video.

Scene ${scene.sceneNumber} (${scene.timeRange}):
Visual Description: ${scene.visualDescription}

Context:
- Company: ${companyName}
- Industry: ${industry}
- Location: ${scene.geoReference}
- Mood: ${scene.caption}${scene5Instructions}

Style Requirements:
- Professional and polished
- Cinematic lighting and composition
- High-quality photorealistic imagery
- Suitable for ${industry} industry
- CRITICAL: ${aspectRatio} aspect ratio (${aspectRatio === "9:16" ? "vertical/portrait" : "horizontal/landscape"}) - FILL THE ENTIRE FRAME
- CRITICAL: NO black bars, NO letterboxing, NO pillarboxing - edge-to-edge content only
- CRITICAL: The subject must fill the full ${aspectRatio === "9:16" ? "vertical" : "horizontal"} frame completely
- Modern, clean aesthetic
- No text overlays (captions will be added separately)
- Relevant to: ${scene.seoKeywords.join(", ")}

Visual Elements:
- ${scene.visualDescription}
- Professional business setting
- Appropriate for social media
- Eye-catching and engaging`;

    // Add centralized image brand lock
    const imagePrompt = `${baseImagePrompt}\n\n${createImageBrandLockPromptSegment(companyName)}`;

    console.log(`📸 Generating image for Scene ${scene.sceneNumber} (aspect ratio: ${aspectRatio})...`);

    // Helper function to extract image data from Gemini response
    const extractImageData = (response: any): string | null => {
      if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
            return part.inlineData.data;
          }
        }
      }
      return null;
    };

    // CRITICAL FIX: Pass aspectRatio to Gemini API to prevent square/1:1 default
    // Without this, Gemini generates square images which causes black bars when resized
    let response = await genAI.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ role: "user", parts: [{ text: imagePrompt }] }],
      config: {
        responseModalities: ["Image"],
        imageConfig: {
          aspectRatio: aspectRatio, // "9:16" for vertical, "16:9" for horizontal
        },
      },
    });

    // Extract image from response
    let imageData = extractImageData(response);

    // RETRY LOGIC: If no image returned (safety filter or refusal), try with simplified fallback prompt
    if (!imageData) {
      console.warn(`  ⚠️ Scene ${scene.sceneNumber}: No image data - retrying with fallback prompt...`);
      
      // Check for safety issues
      if (response.candidates?.[0]?.finishReason === 'SAFETY' || 
          response.promptFeedback?.blockReason) {
        console.warn(`  ⚠️ Scene ${scene.sceneNumber}: Safety filter triggered, using generic fallback`);
      }

      // Simplified fallback prompt that Gemini is more likely to accept
      const fallbackPrompt = scene.sceneNumber === 5
        ? `Create a beautiful, professional abstract background image.
           
           Requirements:
           - Soft gradient colors (blues, greens, or warm neutrals)
           - Elegant bokeh or soft lighting effects
           - Minimal and clean composition
           - Professional business aesthetic
           - ${aspectRatio} aspect ratio - fill entire frame
           - No text, no logos, no people
           - Suitable as a background for text overlay
           
           This is a simple abstract background - please generate it.`
        : `Create a professional cinematic image.
           
           Scene: ${scene.visualDescription}
           Setting: ${industry} industry in ${scene.geoReference}
           Style: Professional, modern, high-quality photography
           Aspect ratio: ${aspectRatio} - fill entire frame
           
           Generate a visually appealing professional image.`;

      response = await genAI.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: [{ role: "user", parts: [{ text: fallbackPrompt }] }],
        config: {
          responseModalities: ["Image"],
          imageConfig: {
            aspectRatio: aspectRatio,
          },
        },
      });

      imageData = extractImageData(response);
    }

    if (!imageData) {
      throw new Error(`No image data returned for Scene ${scene.sceneNumber} after retry`);
    }

    console.log(`  ✅ Image ${scene.sceneNumber} generated from Gemini`);

    // Convert base64 to buffer
    const rawImageBuffer = Buffer.from(imageData, "base64");

    // Verify image dimensions from Gemini match expected aspect ratio
    const rawMeta = await sharp(rawImageBuffer).metadata();
    console.log(`  📐 Scene ${scene.sceneNumber}: Gemini output ${rawMeta.width}x${rawMeta.height}`);
    
    // Check if aspect ratio is correct (allow 5% tolerance)
    let needsRescale = false;
    if (rawMeta.width && rawMeta.height) {
      const receivedRatio = rawMeta.width / rawMeta.height;
      const expectedRatio = aspectRatio === "9:16" ? (9 / 16) : (16 / 9);
      const ratioDiff = Math.abs(receivedRatio - expectedRatio) / expectedRatio;
      
      if (ratioDiff > 0.05) {
        console.warn(`  ⚠️ Scene ${scene.sceneNumber}: Aspect ratio mismatch! Expected ${aspectRatio}, got ${receivedRatio.toFixed(2)}. Will resize.`);
        needsRescale = true;
      } else {
        console.log(`  ✅ Scene ${scene.sceneNumber}: Aspect ratio correct (${aspectRatio})`);
      }
    }

    // Process image: only trim/resize if aspect ratio is wrong from Gemini
    let finalBuffer: Buffer;
    try {
      if (needsRescale) {
        // Gemini returned wrong aspect ratio - apply defensive trimming and resize
        console.log(`  🔧 Scene ${scene.sceneNumber}: Applying defensive trim and resize...`);
        const trimmed = await sharp(rawImageBuffer)
          .trim({
            background: { r: 0, g: 0, b: 0, alpha: 1 },
            threshold: 32
          })
          .toBuffer();

        finalBuffer = await sharp(trimmed)
          .resize(targetWidth, targetHeight, {
            fit: "cover",
            position: "centre"
          })
          .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
          .toBuffer();
      } else {
        // Gemini aspect ratio is correct - just resize to exact target dimensions
        console.log(`  ✨ Scene ${scene.sceneNumber}: Direct resize to target (no trimming needed)`);
        finalBuffer = await sharp(rawImageBuffer)
          .resize(targetWidth, targetHeight, {
            fit: "cover", // Cover ensures full frame
            position: "centre"
          })
          .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
          .toBuffer();
      }
        
      // Verify final dimensions
      const finalMeta = await sharp(finalBuffer).metadata();
      console.log(`  ✅ Scene ${scene.sceneNumber}: Final ${finalMeta.width}x${finalMeta.height} (target: ${targetWidth}x${targetHeight})`);
    } catch (error) {
      console.error(`  ❌ Scene ${scene.sceneNumber}: Processing failed, using fallback:`, error);
      // Emergency fallback: center crop from raw image
      finalBuffer = await sharp(rawImageBuffer)
        .resize(targetWidth, targetHeight, {
          fit: "cover",
          position: "centre"
        })
        .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
        .toBuffer();
    }

    // Upload to Replit Object Storage
    const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
    const timestamp = Date.now();
    const fileName = `video-${socialPostId}-scene${scene.sceneNumber}-${timestamp}.jpg`;
    const objectPath = `public/social-videos/${fileName}`;

    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(objectPath);

    await file.save(finalBuffer, {
      contentType: "image/jpeg",
      metadata: {
        cacheControl: "public, max-age=31536000",
      },
    });

    // Public URL served through Next.js API route
    const storageUrl = `/api/public-objects/social-videos/${fileName}`;

    // Save to temporary local file for FFmpeg processing
    const localPath = path.join(tempDir, `${socialPostId}-scene${scene.sceneNumber}.jpg`);
    await fs.writeFile(localPath, finalBuffer);

    console.log(`✅ Scene ${scene.sceneNumber} image ready (${aspectRatio})`);

    return {
      sceneNumber: scene.sceneNumber,
      storageUrl,
      localPath,
      aspectRatio,
    };
  });

  // Wait for all images to complete in parallel
  const results = await Promise.all(imagePromises);

  console.log(`✅ All 5 video images generated in parallel - DONE`);
  return results;
}
