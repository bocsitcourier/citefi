import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

/**
 * POST /api/batches/[id]/fix-image-captions
 * 
 * Fixes existing article images by:
 * 1. Removing image description/figcaption text
 * 2. Adding company URL link under each image instead
 * 3. Converting relative image URLs to absolute URLs for copy-paste
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const { id } = await params;
    const batchId = parseInt(id);

    if (isNaN(batchId)) {
      return NextResponse.json({ error: "Invalid batch ID" }, { status: 400 });
    }

    // Get batch to verify team ownership and get targetUrl
    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)));

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const targetUrl = batch.targetUrl || "#";
    const displayUrl = targetUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

    // Get absolute base URL for images
    const baseUrl = process.env.PUBLIC_BASE_URL 
      ? process.env.PUBLIC_BASE_URL.replace(/\/$/, '')
      : process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : process.env.REPLIT_DEPLOYMENT_URL 
          ? `https://${process.env.REPLIT_DEPLOYMENT_URL}` 
          : '';

    // Get all completed articles in this batch
    const batchArticles = await db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.batchId, batchId),
          inArray(articles.articleStatus, ["COMPLETE", "GPT4_ENHANCED", "REVIEWED"])
        )
      );

    if (batchArticles.length === 0) {
      return NextResponse.json(
        { message: "No completed articles found in this batch" },
        { status: 200 }
      );
    }

    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const results: Array<{ articleId: number; status: string; details: string }> = [];

    for (const article of batchArticles) {
      try {
        let finalHtml = article.finalHtmlContent || "";
        let modified = false;
        let figcaptionsRemoved = 0;
        let urlsFixed = 0;

        // 1. Replace ALL figcaptions with company URL links
        // Use callback-based replace to handle each figcaption individually
        const newUrlDiv = `<div class="text-sm text-primary mt-2"><a href="${targetUrl}" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">${displayUrl}</a></div>`;
        
        finalHtml = finalHtml.replace(
          /<figcaption[^>]*>[\s\S]*?<\/figcaption>/gi,
          (match) => {
            // Skip if it already contains our company URL format
            if (match.includes('text-primary hover:underline') && match.includes(displayUrl)) {
              return match;
            }
            figcaptionsRemoved++;
            modified = true;
            return newUrlDiv;
          }
        );

        // 2. Convert relative image URLs to absolute URLs (if baseUrl is available)
        if (baseUrl) {
          // Use single-pass callback replace for accurate URL conversion
          finalHtml = finalHtml.replace(
            /src="(\/api\/public-objects\/[^"]+)"/gi,
            (fullMatch, relativePath) => {
              const absoluteUrl = `${baseUrl}${relativePath}`;
              urlsFixed++;
              modified = true;
              return `src="${absoluteUrl}"`;
            }
          );
        }

        if (modified) {
          // Update the article
          await db
            .update(articles)
            .set({ finalHtmlContent: finalHtml })
            .where(eq(articles.id, article.id));

          fixedCount++;
          const actions = [];
          if (figcaptionsRemoved > 0) actions.push(`replaced ${figcaptionsRemoved} figcaptions with company URL`);
          if (urlsFixed > 0) actions.push(`converted ${urlsFixed} image URLs to absolute`);
          
          results.push({
            articleId: article.id,
            status: "fixed",
            details: actions.join(", ") || "Modified",
          });
        } else {
          skippedCount++;
          results.push({
            articleId: article.id,
            status: "skipped",
            details: "No figcaptions or relative URLs found to fix",
          });
        }
      } catch (error) {
        errorCount++;
        results.push({
          articleId: article.id,
          status: "error",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        total: batchArticles.length,
        fixed: fixedCount,
        skipped: skippedCount,
        errors: errorCount,
      },
      results,
      config: {
        targetUrl,
        baseUrl: baseUrl || "(not set - relative URLs preserved)",
      },
    });
  } catch (error) {
    console.error("Fix image captions error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fix image captions" },
      { status: 500 }
    );
  }
}
