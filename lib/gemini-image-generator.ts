import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { articleAssets, articles } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { uploadMedia } from "./storage";
import { logError } from "./error-logger";
import { throttledGeminiRequest } from "./gemini";
import { createImageBrandLockPromptSegment } from "./branding";
import { findReusableHeroImage } from "./image-memory";

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
  reused?: boolean;
}

// Timeout wrapper for Gemini API calls (prevents hanging)
async function withTimeout<T>(promise: Promise<T>, ms: number = 60000): Promise<T> {
  const timeout = new Promise<T>((_, reject) => 
    setTimeout(() => reject(new Error(`API call timeout after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

/**
 * Generate (or reuse) the hero image for an article.
 *
 * Strategy — "Search First, Generate Last":
 *   1. Look up the article's keywords + title from DB.
 *   2. Search image memory for a matching hero image from a prior article.
 *   3. If found → reuse it (zero Gemini API cost).
 *   4. If not found → generate ONE new hero image using imagePrompts[0].
 *
 * Inline images are intentionally removed: they added 2–3× API cost with
 * minimal SEO benefit vs. a single high-quality hero image.
 */
export async function generateImagesForArticle(
  articleId: number,
  imagePrompts: string[],
  businessName?: string,
  targetUrl?: string
): Promise<ImageGenerationResult[]> {
  if (!imagePrompts || imagePrompts.length === 0) {
    console.warn(`⚠️ No image prompts provided for article ${articleId} — skipping image generation`);
    return [];
  }

  // ── Step 1: Fetch article metadata for memory lookup ─────────────────────
  let articleKeywords: string[] = [];
  let articleTitle = "";
  let articleTeamId: number | null = null;

  try {
    const [meta] = await db
      .select({
        keywordsJson: articles.keywordsJson,
        seoTitle: articles.seoTitle,
        teamId: articles.teamId,
      })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);

    if (meta) {
      articleKeywords = Array.isArray(meta.keywordsJson) ? (meta.keywordsJson as string[]) : [];
      articleTitle = meta.seoTitle ?? "";
      articleTeamId = meta.teamId ?? null;
    }
  } catch (err) {
    console.warn(`⚠️ Could not fetch article metadata for image memory lookup:`, err instanceof Error ? err.message : err);
  }

  // ── Step 2: Check image memory (Search First) ────────────────────────────
  const reusedUrl = await findReusableHeroImage(articleKeywords, articleTitle, articleTeamId);

  if (reusedUrl) {
    // Reuse existing image — no Gemini API call needed
    try {
      await db
        .update(articles)
        .set({ heroImageUrl: reusedUrl })
        .where(eq(articles.id, articleId));
      console.log(`♻️ Hero image reused for article ${articleId} — $0.00 AI cost`);
    } catch (err) {
      console.error(`❌ Failed to set reused hero image for article ${articleId}:`, err);
    }
    return [{ url: reusedUrl, prompt: "reused", format: "png", reused: true }];
  }

  // ── Step 3: Generate exactly ONE hero image (Generate Last) ──────────────
  const heroPromptRaw = imagePrompts[0]!;
  const heroPrompt = businessName
    ? `${heroPromptRaw}\n\n${createImageBrandLockPromptSegment(businessName)}`
    : heroPromptRaw;

  if (businessName) {
    console.log(`🔒 Brand lock applied to hero image prompt: "${businessName}"`);
  }

  console.log(`🎨 Generating hero image for article ${articleId} (1 API call, hero only)...`);

  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`  📸 Attempt ${attempt}/${MAX_RETRIES}...`);

      const response = await throttledGeminiRequest(() =>
        withTimeout(
          genAI.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: [{ role: "user", parts: [{ text: heroPrompt }] }],
            config: { responseModalities: ["Image"] },
          }),
          120000
        )
      );

      // Extract base64 image data
      let imageData: string | null = null;
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            imageData = part.inlineData.data;
            break;
          }
        }
      }

      if (!imageData) {
        throw new Error("No image data returned from Gemini API");
      }

      const imageBuffer = Buffer.from(imageData, "base64");
      console.log(`  ✅ Image generated (${(imageBuffer.length / 1024).toFixed(2)} KB) — uploading...`);

      const permanentUrl = await uploadMedia({
        fileData: imageBuffer,
        fileName: `article-${articleId}-hero-${Date.now()}.png`,
        contentType: "image/png",
        assetType: "image",
        articleId,
        altText: `Hero image - ${heroPromptRaw.slice(0, 100)}`,
        metadata: {
          generatedAt: new Date().toISOString(),
          model: "gemini-2.5-flash-image",
          isHeroImage: true,
          originalPrompt: heroPromptRaw,
        },
      });

      console.log(`  ☁️ Uploaded: ${permanentUrl}`);

      // Get the asset record created by uploadMedia
      const [asset] = await db
        .select({ id: articleAssets.id })
        .from(articleAssets)
        .where(eq(articleAssets.storageUrl, permanentUrl))
        .limit(1);

      // Persist hero image URL on the article
      await db
        .update(articles)
        .set({ heroImageUrl: permanentUrl })
        .where(eq(articles.id, articleId));

      console.log(`✅ Hero image set for article ${articleId}`);

      return [{ url: permanentUrl, prompt: heroPromptRaw, format: "png", assetId: asset?.id }];
    } catch (error) {
      lastError = error as Error;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ⚠️ Attempt ${attempt}/${MAX_RETRIES} failed:`, errorMsg);

      if (attempt === MAX_RETRIES) {
        await logError({
          errorType: "HERO_IMAGE",
          errorMessage: `Gemini hero image generation failed after ${MAX_RETRIES} attempts: ${errorMsg}`,
          stackTrace: lastError?.stack,
          severity: "error",
          articleId,
        });
      } else {
        const delayMs = Math.pow(2, attempt) * 1000;
        console.log(`  ⏳ Retrying in ${delayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // ── All retries failed: set fallback placeholder ─────────────────────────
  console.error(`❌ Hero image generation failed for article ${articleId} — applying fallback`);
  try {
    await db
      .update(articles)
      .set({ heroImageUrl: FALLBACK_HERO_IMAGE })
      .where(eq(articles.id, articleId));
  } catch (err) {
    console.error(`❌ Failed to set fallback hero image:`, err);
  }

  await logError({
    errorType: "HERO_IMAGE",
    errorMessage: `No hero image available after ${MAX_RETRIES} attempts. Fallback placeholder applied.`,
    severity: "critical",
    articleId,
  });

  return [];
}

export async function generateSingleImage(prompt: string): Promise<string | null> {
  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseModalities: ["Image"] },
    });

    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.data) {
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

// Generate and store a hero image for an article (single-prompt entry point)
export async function generateAndStoreHeroImage(
  prompt: string,
  articleId: number,
  batchId: number,
  businessName?: string
): Promise<string> {
  console.log(`🖼️ Generating hero image with Gemini for article ${articleId}...`);

  const enhancedPrompt = businessName
    ? `${prompt}\n\n${createImageBrandLockPromptSegment(businessName)}`
    : prompt;

  if (businessName) {
    console.log(`🔒 Image-specific brand lock applied: "${businessName}"`);
  }

  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`  📸 Attempt ${attempt}/${MAX_RETRIES}...`);

      const response = await withTimeout(
        genAI.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: [{ role: "user", parts: [{ text: enhancedPrompt }] }],
          config: { responseModalities: ["Image"] },
        }),
        60000
      );

      let imageData: string | null = null;
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            imageData = part.inlineData.data;
            break;
          }
        }
      }

      if (!imageData) {
        throw new Error("No image data returned from Gemini API");
      }

      const imageBuffer = Buffer.from(imageData, "base64");
      console.log(`  ✅ Image generated (${(imageBuffer.length / 1024).toFixed(2)} KB) — uploading...`);

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

      console.log(`  ☁️ Uploaded: ${permanentUrl}`);
      return permanentUrl;
    } catch (error) {
      lastError = error as Error;
      console.error(`  ❌ Attempt ${attempt} failed:`, error instanceof Error ? error.message : error);

      if (attempt < MAX_RETRIES) {
        const delayMs = Math.pow(2, attempt) * 1000;
        console.log(`  ⏳ Retrying in ${delayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

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
