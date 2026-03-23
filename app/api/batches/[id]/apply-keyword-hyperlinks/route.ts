import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { 
  extractKeywordsFromArticle,
  applyKeywordHyperlinks,
  validateAndCorrectHyperlinks,
  BusinessProfile 
} from "@/lib/keyword-hyperlink-pipeline";

/**
 * POST /api/batches/[id]/apply-keyword-hyperlinks
 * 
 * Enterprise 3-Stage Keyword Hyperlinking Pipeline:
 * 1. Extract 25 long-phrase keywords specific to the business
 * 2. Programmatically apply hyperlinks to article body + FAQ
 * 3. Validate and report coverage
 * 
 * This is the PERMANENT FIX for missing hyperlinks in articles.
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

    // Get batch to verify team ownership and get business profile
    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)));

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const targetUrl = batch.targetUrl || "";
    const businessName = batch.businessName || "Business";
    
    // Extract geographicFocus from generationParams jsonb
    const generationParams = (batch.generationParams as Record<string, any>) || {};
    const geographicFocus = generationParams.geographicFocus || "";

    if (!targetUrl) {
      return NextResponse.json(
        { error: "Batch has no target URL configured" },
        { status: 400 }
      );
    }

    // Build enriched business profile from batch data
    // Extract services from coreTopic and generationParams
    const services: string[] = [batch.coreTopic];
    
    // Try to extract additional service terms from generationParams
    if (generationParams.audience) {
      services.push(String(generationParams.audience));
    }
    if (generationParams.tone) {
      services.push(String(generationParams.tone));
    }
    
    // Extract location data - try multiple sources
    const location = geographicFocus || 
                     (batch.businessAddress ? batch.businessAddress.split(',')[0] : '') ||
                     'Local Area';
    
    const profile: BusinessProfile = {
      businessName,
      targetUrl,
      services: services.filter(Boolean),
      location,
      additionalLocations: [],
    };
    
    console.log(`📋 Business Profile: ${businessName}, Services: ${services.join(', ')}, Location: ${location}`);

    // Get all completed articles in this batch
    const batchArticles = await db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.batchId, batchId),
          inArray(articles.articleStatus, ["COMPLETE", "GPT4_ENHANCED", "REVIEWED", "CHATGPT_REVIEWED"])
        )
      );

    if (batchArticles.length === 0) {
      return NextResponse.json(
        { message: "No completed articles found in this batch" },
        { status: 200 }
      );
    }

    // Process each article: Extract keywords FROM article content, then apply hyperlinks
    console.log(`🔗 Processing ${batchArticles.length} articles (extract keywords → apply hyperlinks)...`);
    
    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let totalKeywordsExtracted = 0;
    const results: Array<{
      articleId: number;
      title: string;
      status: string;
      keywordsExtracted: number;
      keywordsLinked: number;
      keywordsMissing: number;
      faqKeywordsLinked: number;
    }> = [];

    for (const article of batchArticles) {
      try {
        const finalHtml = article.finalHtmlContent || "";
        
        if (!finalHtml || finalHtml.length < 500) {
          skippedCount++;
          results.push({
            articleId: article.id,
            title: article.chosenTitle || "Untitled",
            status: "skipped",
            keywordsExtracted: 0,
            keywordsLinked: 0,
            keywordsMissing: 0,
            faqKeywordsLinked: 0,
          });
          continue;
        }

        // Stage 1: Extract keywords FROM this article's content
        console.log(`  📝 Article ${article.id}: Extracting keywords from content...`);
        let keywords: string[] = [];
        
        try {
          const extraction = await extractKeywordsFromArticle(finalHtml, profile);
          keywords = extraction.rawKeywords;
          totalKeywordsExtracted += keywords.length;
          console.log(`    ✅ Found ${keywords.length} linkable phrases in article`);
        } catch (extractError) {
          console.warn(`    ⚠️ Keyword extraction failed, skipping:`, extractError);
          skippedCount++;
          results.push({
            articleId: article.id,
            title: article.chosenTitle || "Untitled",
            status: "extraction_failed",
            keywordsExtracted: 0,
            keywordsLinked: 0,
            keywordsMissing: 0,
            faqKeywordsLinked: 0,
          });
          continue;
        }

        if (keywords.length === 0) {
          skippedCount++;
          results.push({
            articleId: article.id,
            title: article.chosenTitle || "Untitled",
            status: "no_keywords_found",
            keywordsExtracted: 0,
            keywordsLinked: 0,
            keywordsMissing: 0,
            faqKeywordsLinked: 0,
          });
          continue;
        }

        // Stage 2: Apply keyword hyperlinks programmatically
        let result = applyKeywordHyperlinks(finalHtml, keywords, targetUrl, {
          maxLinksPerKeyword: 1,
          excludeHeaders: true,
          includeFaq: true,
        });

        let finalContent = result.correctedHtml;
        let wasValidated = false;

        // Stage 3: If significant keywords missing (>30%), use GPT-4 validation pass
        const missingRatio = keywords.length > 0 ? result.keywordsMissing.length / keywords.length : 0;
        if (missingRatio > 0.3 && result.keywordsMissing.length > 3) {
          console.log(`    ⚠️ ${result.keywordsMissing.length} keywords missing (${Math.round(missingRatio * 100)}%), running validation...`);
          
          try {
            const validationResult = await validateAndCorrectHyperlinks(
              result.correctedHtml,
              result.keywordsMissing,
              targetUrl,
              businessName
            );
            
            if (validationResult.corrections.length > 0) {
              finalContent = validationResult.correctedHtml;
              wasValidated = true;
              console.log(`      ✅ Validation made ${validationResult.corrections.length} corrections`);
            }
          } catch (valError) {
            console.warn(`      ⚠️ Validation pass failed, using programmatic result:`, valError);
          }
        }

        // Update article with hyperlinked content
        await db
          .update(articles)
          .set({
            finalHtmlContent: finalContent,
            hyperlinkedKeywordsJson: result.keywordsFound.map(k => ({
              phrase: k,
              url: targetUrl,
              type: "long_phrase_keyword",
              anchorText: k,
            })),
          })
          .where(eq(articles.id, article.id));

        fixedCount++;
        results.push({
          articleId: article.id,
          title: article.chosenTitle || "Untitled",
          status: wasValidated ? "fixed+validated" : "fixed",
          keywordsExtracted: keywords.length,
          keywordsLinked: result.keywordsLinked,
          keywordsMissing: result.keywordsMissing.length,
          faqKeywordsLinked: result.faqKeywordsLinked,
        });

        console.log(`  ✅ Article ${article.id}: ${result.keywordsLinked}/${keywords.length} keywords linked${wasValidated ? ' (validated)' : ''}`);

      } catch (error) {
        errorCount++;
        results.push({
          articleId: article.id,
          title: article.chosenTitle || "Untitled",
          status: "error",
          keywordsExtracted: 0,
          keywordsLinked: 0,
          keywordsMissing: 0,
          faqKeywordsLinked: 0,
        });
        console.error(`  ❌ Article ${article.id} error:`, error);
      }
    }

    // Calculate overall stats
    const totalKeywordsLinked = results.reduce((sum, r) => sum + r.keywordsLinked, 0);
    const avgKeywordsPerArticle = fixedCount > 0 ? Math.round(totalKeywordsLinked / fixedCount) : 0;
    const avgKeywordsExtracted = fixedCount > 0 ? Math.round(totalKeywordsExtracted / fixedCount) : 0;

    console.log(`✅ Keyword hyperlink pipeline complete for batch ${batchId}`);
    console.log(`   Articles: ${fixedCount} fixed, ${skippedCount} skipped, ${errorCount} errors`);
    console.log(`   Keywords: ${totalKeywordsExtracted} extracted, ${totalKeywordsLinked} linked, avg ${avgKeywordsPerArticle} linked per article`);

    return NextResponse.json({
      success: true,
      batchId,
      summary: {
        totalArticles: batchArticles.length,
        fixed: fixedCount,
        skipped: skippedCount,
        errors: errorCount,
        totalKeywordsExtracted,
        totalKeywordsLinked,
        avgKeywordsExtracted,
        avgKeywordsLinked: avgKeywordsPerArticle,
      },
      results,
    });

  } catch (error) {
    console.error("Apply keyword hyperlinks error:", error);
    const statusCode = (error as any)?.statusCode ?? 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to apply keyword hyperlinks" },
      { status: statusCode }
    );
  }
}
