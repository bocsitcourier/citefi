import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { articleAssets, articles } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { uploadMedia } from "./storage";
import pLimit from "p-limit";
import { logError } from "./error-logger";
import { throttledGeminiRequest } from "./gemini";
import { createImageBrandLockPromptSegment } from "./branding";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required for image generation");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Fallback placeholder image (data URI - simple gradient)
const FALLBACK_HERO_IMAGE = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAyNCIgaGVpZ2h0PSIxMDI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0iZyIgeDE9IjAlIiB5MT0iMCUiIHgyPSIxMDAlIiB5Mj0iMTAwJSI+PHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6cmdiKDEzMywgNzcsIDI1MCk7c3RvcC1vcGFjaXR5OjEiIC8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjpyZ2IoMTk5LCAxNTAsIDI1NSk7c3RvcC1vcGFjaXR5OjEiIC8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMjQiIGhlaWdodD0iMTAyNCIgZmlsbD0idXJsKCNnKSIgLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjQ4IiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlIFBlbmRpbmc8L3RleHQ+PC9zdmc+";

export interface ImageGenerationResult {
  url: string;
  prompt: string;
  format: string;
  assetId?: number;
}

// LIGHTNING-FAST: 10 concurrent Gemini API calls at a time
const IMAGE_CONCURRENCY_LIMIT = 10;

// Timeout wrapper for Gemini API calls (prevents hanging)
async function withTimeout<T>(promise: Promise<T>, ms: number = 60000): Promise<T> {
  const timeout = new Promise<T>((_, reject) => 
    setTimeout(() => reject(new Error(`API call timeout after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

export async function generateImagesForArticle(
  articleId: number,
  imagePrompts: string[],
  businessName?: string,
  targetUrl?: string
): Promise<ImageGenerationResult[]> {
  console.log(`🎨 Generating ${imagePrompts.length} images with Gemini for article ${articleId} (${IMAGE_CONCURRENCY_LIMIT} concurrent)...`);
  
  // Add IMAGE-SPECIFIC brand lock segment to each prompt if businessName is provided
  const enhancedPrompts = imagePrompts.map(prompt => {
    if (businessName) {
      const brandLock = createImageBrandLockPromptSegment(businessName);
      return `${prompt}\n\n${brandLock}`;
    }
    return prompt;
  });
  
  if (businessName) {
    console.log(`🔒 Brand lock applied to image prompts: "${businessName}"`);
  }
  
  // Throttle concurrent Gemini API calls to respect rate limits
  const limit = pLimit(IMAGE_CONCURRENCY_LIMIT);
  
  // Generate all images in parallel with throttling
  const imagePromises = enhancedPrompts.map((prompt, i) => 
    limit(async () => {
      // Retry logic with exponential backoff (3 attempts)
      const MAX_RETRIES = 3;
      let lastError: Error | null = null;
      
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          console.log(`  📸 Image ${i + 1}/${enhancedPrompts.length}: Generating with Gemini${attempt > 1 ? ` (retry ${attempt}/${MAX_RETRIES})` : ''}...`);
          
          // Generate image using Gemini 2.5 Flash Image with 60s timeout AND rate limiting
          const response = await throttledGeminiRequest(() => withTimeout(
            genAI.models.generateContent({
              model: "gemini-2.5-flash-image",
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              config: {
                responseModalities: ["Image"],
              },
            }),
            60000 // 60 second timeout
          ));

          // Extract image from response
          let imageData: string | null = null;
          if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
              if (part.inlineData && part.inlineData.data) {
                imageData = part.inlineData.data;
                break;
              }
            }
          }

          if (!imageData) {
            throw new Error("No image data returned from Gemini API");
          }

          console.log(`  ✅ Image ${i + 1} generated - uploading to permanent storage...`);

          // Convert base64 to buffer
          const imageBuffer = Buffer.from(imageData, "base64");
          console.log(`  📥 Image ${i + 1} size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);

          // Upload to permanent storage
          const permanentUrl = await uploadMedia({
            fileData: imageBuffer,
            fileName: `article-${articleId}-image-${i + 1}.png`,
            contentType: "image/png",
            assetType: "image",
            articleId,
            altText: `Image ${i + 1} - ${prompt.slice(0, 100)}`,
            metadata: {
              generatedAt: new Date().toISOString(),
              model: "gemini-2.5-flash-image",
              originalPrompt: prompt,
            },
          });

          console.log(`  ☁️ Uploaded to permanent storage: ${permanentUrl}`);

          // Get the asset ID that was created by uploadMedia
          const [asset] = await db
            .select({ id: articleAssets.id })
            .from(articleAssets)
            .where(eq(articleAssets.storageUrl, permanentUrl))
            .limit(1);

          // Success! Return result
          return {
            url: permanentUrl,
            prompt,
            format: "png",
            assetId: asset?.id,
          };

        } catch (error) {
          lastError = error as Error;
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`  ⚠️ Image ${i + 1} attempt ${attempt}/${MAX_RETRIES} failed:`, errorMsg);
          
          // Log error to database (warning for retries, error for final failure)
          if (attempt === MAX_RETRIES) {
            await logError({
              errorType: "DALLE",
              errorMessage: `Gemini image generation failed after ${MAX_RETRIES} attempts: ${errorMsg}`,
              stackTrace: error instanceof Error ? error.stack : undefined,
              severity: "error",
              articleId,
            });
          }
          
          // If not the last retry, wait with exponential backoff
          if (attempt < MAX_RETRIES) {
            const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s
            console.log(`  ⏳ Retrying in ${delayMs / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }
      
      // All retries failed
      console.error(`  ❌ Failed to generate image ${i + 1} after ${MAX_RETRIES} attempts`);
      return null;
    })
  );

  // Wait for all images to complete
  const imageResults = await Promise.all(imagePromises);
  
  // Filter out failed images (remove nulls)
  const results: ImageGenerationResult[] = imageResults.filter((r) => r !== null) as ImageGenerationResult[];

  console.log(`✅ Generated ${results.length}/${imagePrompts.length} images successfully with Gemini`);
  
  // CRITICAL: Set first image as hero image
  if (results.length > 0) {
    try {
      const heroImageUrl = results[0].url;
      console.log(`🎯 Setting hero image for article ${articleId}: ${heroImageUrl}`);
      
      await db
        .update(articles)
        .set({ heroImageUrl })
        .where(eq(articles.id, articleId));
      
      console.log(`✅ Hero image set successfully`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to set hero image for article ${articleId}:`, errorMsg);
      
      await logError({
        errorType: "HERO_IMAGE",
        errorMessage: `Failed to set hero image for article ${articleId}: ${errorMsg}`,
        stackTrace: error instanceof Error ? error.stack : undefined,
        severity: "error",
        articleId,
      });
    }
  } else if (imagePrompts.length > 0) {
    // All image generation failed - set fallback placeholder and log critical error
    console.error(`❌ CRITICAL: No images generated for article ${articleId} after ${imagePrompts.length} attempts`);
    console.log(`⚠️  Setting fallback placeholder image for article ${articleId}`);
    
    try {
      await db
        .update(articles)
        .set({ heroImageUrl: FALLBACK_HERO_IMAGE })
        .where(eq(articles.id, articleId));
      
      console.log(`✅ Fallback hero image set successfully`);
    } catch (error) {
      console.error(`❌ Failed to set fallback hero image:`, error);
    }
    
    await logError({
      errorType: "HERO_IMAGE",
      errorMessage: `No hero image available - all ${imagePrompts.length} Gemini generations failed. Fallback placeholder applied.`,
      severity: "critical",
      articleId,
    });
  }
  
  // CRITICAL: Update article HTML to include images
  if (results.length > 0) {
    try {
      // Fetch current article content
      const [article] = await db
        .select({ finalHtmlContent: articles.finalHtmlContent })
        .from(articles)
        .where(eq(articles.id, articleId));

      if (article?.finalHtmlContent) {
        let updatedHtml = article.finalHtmlContent;
        
        // Use regex to find all </p> tags and insert images evenly
        const paragraphRegex = /<\/p>/gi;
        const paragraphMatches = Array.from(updatedHtml.matchAll(paragraphRegex));
        const paragraphCount = paragraphMatches.length;
        
        if (paragraphCount === 0) {
          console.warn(`⚠️ No paragraphs found in article ${articleId}, skipping image integration`);
          return results;
        }
        
        // Calculate safe interval (minimum 1 to avoid division by zero)
        const imageInterval = Math.max(1, Math.floor(paragraphCount / (results.length + 1)));
        
        let insertionsMade = 0;
        let lastIndex = 0;
        const parts: string[] = [];
        
        paragraphMatches.forEach((match, i) => {
          const matchEnd = match.index! + match[0].length;
          
          // Add content up to and including this </p> tag
          parts.push(updatedHtml.slice(lastIndex, matchEnd));
          lastIndex = matchEnd;
          
          // Insert image after every imageInterval paragraphs
          const shouldInsertImage = 
            (i + 1) % imageInterval === 0 && 
            insertionsMade < results.length &&
            i < paragraphMatches.length - 1; // Don't insert after last paragraph
          
          if (shouldInsertImage) {
            const image = results[insertionsMade];
            // Generate SEO-friendly alt text (brief, descriptive, max 10 words)
            const altText = image.prompt.split('.')[0].slice(0, 80).replace(/[^\w\s-]/g, '').trim();
            // Use targetUrl directly (passed from batch configuration)
            const companyUrl = targetUrl || '#';
            // Format display URL (remove protocol, keep clean)
            const displayUrl = companyUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
            const imageHtml = `\n<figure class="article-image my-6">
  <img src="${image.url}" alt="${altText}" class="w-full rounded-lg shadow-md" loading="lazy" />
  <div class="text-sm text-primary mt-2"><a href="${companyUrl}" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">${displayUrl}</a></div>
</figure>\n`;
            parts.push(imageHtml);
            insertionsMade++;
          }
        });
        
        // Add any remaining content after last paragraph
        parts.push(updatedHtml.slice(lastIndex));
        updatedHtml = parts.join('');
        
        // Update article with integrated images
        await db
          .update(articles)
          .set({ finalHtmlContent: updatedHtml })
          .where(eq(articles.id, articleId));
        
        console.log(`✅ Integrated ${insertionsMade} images into article ${articleId} HTML`);
      }
    } catch (error) {
      console.error(`❌ Failed to integrate images into article ${articleId} HTML:`, error);
      // Don't throw - images are saved, integration is a bonus
    }
  }
  
  return results;
}

export async function generateSingleImage(prompt: string): Promise<string | null> {
  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseModalities: ["Image"],
      },
    });

    // Extract image from response
    if (response.candidates && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          // Convert base64 to data URL for immediate use
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Gemini image generation error:", error);
    return null;
  }
}

// Generate and store a hero image for an article
export async function generateAndStoreHeroImage(
  prompt: string,
  articleId: number,
  batchId: number,
  businessName?: string
): Promise<string> {
  console.log(`🖼️ Generating hero image with Gemini for article ${articleId}...`);
  
  // Add IMAGE-SPECIFIC brand lock segment to prompt if businessName is provided
  const enhancedPrompt = businessName 
    ? `${prompt}\n\n${createImageBrandLockPromptSegment(businessName)}`
    : prompt;
  
  if (businessName) {
    console.log(`🔒 Image-specific brand lock applied to hero image: "${businessName}"`);
  }
  
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`  📸 Attempt ${attempt}/${MAX_RETRIES}...`);
      
      // Generate image using Gemini 2.5 Flash Image
      const response = await withTimeout(
        genAI.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: [{ role: "user", parts: [{ text: enhancedPrompt }] }],
          config: {
            responseModalities: ["Image"],
          },
        }),
        60000
      );

      // Extract image from response
      let imageData: string | null = null;
      if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
            imageData = part.inlineData.data;
            break;
          }
        }
      }
      
      if (!imageData) {
        throw new Error("No image data returned from Gemini API");
      }

      console.log(`  ✅ Image generated - uploading to permanent storage...`);

      // Convert base64 to buffer
      const imageBuffer = Buffer.from(imageData, "base64");
      console.log(`  📥 Downloaded image (${(imageBuffer.length / 1024).toFixed(2)} KB)`);

      // Upload to permanent storage
      const permanentUrl = await uploadMedia({
        fileData: imageBuffer,
        fileName: `hero-image-${articleId}-${Date.now()}.png`,
        contentType: "image/png",
        assetType: "image",
        articleId,
        altText: `Hero image - ${prompt.slice(0, 100)}`,
        metadata: {
          generatedAt: new Date().toISOString(),
          model: "gemini-2.5-flash-image",
          isHeroImage: true,
          originalPrompt: prompt,
        },
      });

      console.log(`  ☁️ Uploaded to permanent storage: ${permanentUrl}`);
      return permanentUrl;
      
    } catch (error) {
      lastError = error as Error;
      console.error(`  ❌ Attempt ${attempt} failed:`, error instanceof Error ? error.message : error);
      
      if (attempt < MAX_RETRIES) {
        const delayMs = Math.pow(2, attempt) * 1000;
        console.log(`  ⏳ Retrying in ${delayMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  // All retries failed - use fallback
  console.error(`  ❌ All ${MAX_RETRIES} attempts failed for hero image`);
  await logError({
    errorType: "HERO_IMAGE",
    errorMessage: `Gemini hero image generation failed after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    stackTrace: lastError?.stack,
    severity: "error",
    articleId,
  });
  
  return FALLBACK_HERO_IMAGE;
}
