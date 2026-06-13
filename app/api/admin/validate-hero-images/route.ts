import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { logError } from "@/lib/error-logger";
import { requireAdmin } from "@/lib/api/auth";
import pLimit from "p-limit";

export const dynamic = "force-dynamic";

// Security: Max concurrent URL validations to prevent resource exhaustion
const MAX_CONCURRENT_VALIDATIONS = 5;
const VALIDATION_TIMEOUT_MS = 5000;

interface ValidationResult {
  total: number;
  withHeroImages: number;
  withoutHeroImages: number;
  brokenImages: number;
  validImages: number;
  checkedUrls: Array<{
    articleId: number;
    url: string;
    status: "valid" | "broken" | "timeout";
    statusCode?: number;
  }>;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const checkUrls = searchParams.get("checkUrls") === "true"; // Optional: actually fetch URLs to validate

    // Get all articles
    const allArticles = await db
      .select({
        id: articles.id,
        chosenTitle: articles.chosenTitle,
        heroImageUrl: articles.heroImageUrl,
      })
      .from(articles);

    const result: ValidationResult = {
      total: allArticles.length,
      withHeroImages: 0,
      withoutHeroImages: 0,
      brokenImages: 0,
      validImages: 0,
      checkedUrls: [],
    };

    // Count articles with/without hero images
    const articlesWithHeroImages = allArticles.filter(a => a.heroImageUrl);
    result.withHeroImages = articlesWithHeroImages.length;
    result.withoutHeroImages = allArticles.length - articlesWithHeroImages.length;

    // Optionally validate URLs in parallel (with concurrency limit)
    if (checkUrls && articlesWithHeroImages.length > 0) {
      const limit = pLimit(MAX_CONCURRENT_VALIDATIONS);
      
      const validationPromises = articlesWithHeroImages.map(article => 
        limit(async () => {
          if (!article.heroImageUrl) return;
          
          // Security: Only validate URLs from trusted domains (strict hostname validation)
          const urlLower = article.heroImageUrl.toLowerCase();
          
          // Skip data URIs (they're always valid and safe)
          if (urlLower.startsWith("data:")) {
            result.validImages++;
            result.checkedUrls.push({
              articleId: article.id,
              url: article.heroImageUrl,
              status: "valid",
            });
            return;
          }
          
          // Strict hostname validation for HTTP(S) URLs
          let isTrustedDomain = false;
          try {
            const parsedUrl = new URL(article.heroImageUrl);
            const hostname = parsedUrl.hostname.toLowerCase();
            
            // Only allow exact Replit Object Storage domains
            isTrustedDomain = 
              hostname.endsWith(".id.repl.co") ||  // Replit Object Storage
              hostname.endsWith(".repl.co");         // Legacy Replit domains
          } catch (e) {
            // Invalid URL format
            isTrustedDomain = false;
          }
          
          if (!isTrustedDomain) {
            result.checkedUrls.push({
              articleId: article.id,
              url: article.heroImageUrl,
              status: "broken",
            });
            result.brokenImages++;
            
            await logError({
              errorType: "HERO_IMAGE",
              errorMessage: `Untrusted hero image domain for article ${article.id}: ${article.heroImageUrl}`,
              severity: "warning",
              articleId: article.id,
            });
            return;
          }

          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

            const response = await fetch(article.heroImageUrl, {
              method: "HEAD",
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.ok) {
              result.validImages++;
              result.checkedUrls.push({
                articleId: article.id,
                url: article.heroImageUrl,
                status: "valid",
                statusCode: response.status,
              });
            } else {
              result.brokenImages++;
              result.checkedUrls.push({
                articleId: article.id,
                url: article.heroImageUrl,
                status: "broken",
                statusCode: response.status,
              });

              await logError({
                errorType: "HERO_IMAGE",
                errorMessage: `Broken hero image for article ${article.id}: HTTP ${response.status}`,
                severity: "warning",
                articleId: article.id,
              });
            }
          } catch (error) {
            result.brokenImages++;
            const errorMsg = error instanceof Error ? error.message : "Unknown error";
            
            result.checkedUrls.push({
              articleId: article.id,
              url: article.heroImageUrl,
              status: "timeout",
            });

            await logError({
              errorType: "HERO_IMAGE",
              errorMessage: `Failed to validate hero image for article ${article.id}: ${errorMsg}`,
              severity: "warning",
              articleId: article.id,
            });
          }
        })
      );
      
      await Promise.all(validationPromises);
    }

    return NextResponse.json({
      success: true,
      data: result,
      urlsChecked: checkUrls,
      message: checkUrls
        ? `Validated ${result.withHeroImages} hero images`
        : `Found ${result.withHeroImages} articles with hero images (use ?checkUrls=true to validate URLs)`,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[HERO_IMAGE_VALIDATION] Error:", errorMsg);
    
    // Log route-level failure to database
    await logError({
      errorType: "HERO_IMAGE",
      errorMessage: `Hero image validation endpoint failed: ${errorMsg}`,
      stackTrace: error instanceof Error ? error.stack : undefined,
      severity: "error",
    });
    
    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}
