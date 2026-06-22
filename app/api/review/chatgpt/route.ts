import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { generateHyperlinks } from "@/lib/chatgpt-review/hyperlinker";
import { analyzeSEO } from "@/lib/chatgpt-review/seo-analyzer";
import { generateHashtags } from "@/lib/chatgpt-review/hashtag-enrichment";
import { generateSocialSnippets } from "@/lib/chatgpt-review/social-snippets";
import { enhanceImagePrompts } from "@/lib/chatgpt-review/image-enhancer";
import { checkTeamPaywall, paywallErrorBody } from "@/lib/billing/paywall";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq, and } from "drizzle-orm";

export interface ChatGPTReviewRequest {
  articleId: number;
  content: string;
  title: string;
  metaDescription: string;
  keywords: string[];
  imagePrompts?: string[];
  coreTopic: string;
  targetUrl: string;
  competitorUrls?: string[];
  geographicFocus?: string;
  businessName?: string;
  industry?: string;
}

export interface ChatGPTReviewResponse {
  success: boolean;
  articleId: number;
  enrichment: {
    hyperlinks: any;
    seoAnalysis: any;
    hashtags: any;
    socialSnippets: any;
    enhancedImages?: any;
  };
  seoScore: number;
  tokenUsage: {
    hyperlinks: number;
    seoAnalysis: number;
    hashtags: number;
    socialSnippets: number;
    imageEnhancement: number;
    total: number;
  };
  processingTime: number;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { userId, teamId } = await requireTeamMember(request);
    const body = (await request.json()) as ChatGPTReviewRequest;

    const {
      articleId,
      content,
      title,
      metaDescription,
      keywords,
      imagePrompts = [],
      coreTopic,
      targetUrl,
      competitorUrls,
      geographicFocus,
      businessName,
      industry,
    } = body;

    // Validate required fields
    if (!articleId || !content || !title || !coreTopic || !targetUrl) {
      return NextResponse.json(
        { error: "Missing required fields: articleId, content, title, coreTopic, targetUrl" },
        { status: 400 }
      );
    }

    // PAYWALL: Ensure the team has active access before running expensive AI work.
    const paywallResult = await checkTeamPaywall(teamId);
    if (!paywallResult.allowed) {
      return NextResponse.json(paywallErrorBody(paywallResult), { status: 402 });
    }

    // SECURITY: Verify article ownership BEFORE spending any OpenAI tokens.
    const [ownedArticle] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.teamId, teamId)))
      .limit(1);

    if (!ownedArticle) {
      return NextResponse.json(
        { error: "Article not found" },
        { status: 404 }
      );
    }

    console.log(`[ChatGPT Review] Starting review for article ${articleId}...`);

    // Execute all ChatGPT enrichment tasks in parallel.
    // Use allSettled so one optional module failure cannot kill the whole stage.
    const [
      hyperlinkSettled,
      seoSettled,
      hashtagSettled,
      socialSettled,
      imageSettled,
    ] = await Promise.allSettled([
      generateHyperlinks(content, coreTopic, targetUrl, competitorUrls),
      analyzeSEO(content, title, metaDescription, keywords, geographicFocus, businessName),
      generateHashtags(title, content, keywords, geographicFocus, industry),
      generateSocialSnippets(title, content, keywords, geographicFocus),
      imagePrompts.length > 0
        ? enhanceImagePrompts(imagePrompts, coreTopic, keywords, geographicFocus)
        : Promise.resolve(null),
    ]);

    // Extract values with safe fallbacks for any failed sub-modules
    const hyperlinkResult = hyperlinkSettled.status === "fulfilled"
      ? hyperlinkSettled.value
      : { totalLinks: 0, keywords: [], tokenUsage: { totalTokens: 0 } };
    const seoAnalysis = seoSettled.status === "fulfilled"
      ? seoSettled.value
      : { seoScore: 0, recommendations: [], readability: null, localSignals: null, tokenUsage: { totalTokens: 0 } };
    const hashtagResult = hashtagSettled.status === "fulfilled"
      ? hashtagSettled.value
      : { hashtags: [], categories: {}, totalCount: 0, tokenUsage: { totalTokens: 0 } };
    const socialSnippets = socialSettled.status === "fulfilled"
      ? socialSettled.value
      : { tokenUsage: { totalTokens: 0 } };
    const enhancedImages = imageSettled.status === "fulfilled"
      ? imageSettled.value
      : null;

    // Log any failures from optional sub-modules
    if (hyperlinkSettled.status === "rejected")
      console.warn(`[ChatGPT Review] Hyperlink generation failed for article ${articleId}:`, hyperlinkSettled.reason);
    if (seoSettled.status === "rejected")
      console.warn(`[ChatGPT Review] SEO analysis failed for article ${articleId}:`, seoSettled.reason);
    if (hashtagSettled.status === "rejected")
      console.warn(`[ChatGPT Review] Hashtag generation failed for article ${articleId}:`, hashtagSettled.reason);
    if (socialSettled.status === "rejected")
      console.warn(`[ChatGPT Review] Social snippets failed for article ${articleId}:`, socialSettled.reason);
    if (imageSettled.status === "rejected")
      console.warn(`[ChatGPT Review] Image enhancement failed for article ${articleId}:`, imageSettled.reason);

    console.log(`[ChatGPT Review] Enrichment complete for article ${articleId}`);
    console.log(`  - Hyperlinks: ${hyperlinkResult.totalLinks} links generated`);
    console.log(`  - SEO Score: ${seoAnalysis.seoScore}/100`);
    console.log(`  - Hashtags: ${hashtagResult.totalCount} hashtags`);
    console.log(`  - Social Snippets: OG, Twitter, LinkedIn ready`);
    if (enhancedImages) {
      console.log(`  - Images: ${(enhancedImages as any)?.enhancedPrompts?.length ?? 0} prompts enhanced`);
    }

    // Calculate actual token usage from OpenAI responses
    const tokenUsage = {
      hyperlinks: hyperlinkResult.tokenUsage.totalTokens,
      seoAnalysis: seoAnalysis.tokenUsage.totalTokens,
      hashtags: hashtagResult.tokenUsage.totalTokens,
      socialSnippets: (socialSnippets as any)?.tokenUsage?.totalTokens ?? 0,
      imageEnhancement: (enhancedImages as any)?.tokenUsage?.totalTokens || 0,
      total:
        hyperlinkResult.tokenUsage.totalTokens +
        seoAnalysis.tokenUsage.totalTokens +
        hashtagResult.tokenUsage.totalTokens +
        ((socialSnippets as any)?.tokenUsage?.totalTokens ?? 0) +
        ((enhancedImages as any)?.tokenUsage?.totalTokens || 0),
    };

    // Build meta enrichment object
    const metaEnrichment = {
      socialSnippets,
      hashtags: hashtagResult.hashtags,
      hashtagCategories: hashtagResult.categories,
      seoRecommendations: seoAnalysis.recommendations,
      readability: seoAnalysis.readability,
      localSignals: seoAnalysis.localSignals,
      enhancedImages: (enhancedImages as any)?.enhancedPrompts || [],
    };

    // Update article in database with enriched data
    await db
      .update(articles)
      .set({
        seoScore: seoAnalysis.seoScore,
        hyperlinkedKeywordsJson: hyperlinkResult.keywords,
        metaEnrichment: metaEnrichment as any,
        updatedAt: new Date(),
      })
      .where(and(eq(articles.id, articleId), eq(articles.teamId, teamId)));

    console.log(`[ChatGPT Review] Database updated for article ${articleId}`);
    console.log(`[ChatGPT Review] Token usage: ${tokenUsage.total} total tokens`);

    const processingTime = Date.now() - startTime;

    const response: ChatGPTReviewResponse = {
      success: true,
      articleId,
      enrichment: {
        hyperlinks: hyperlinkResult,
        seoAnalysis,
        hashtags: hashtagResult,
        socialSnippets,
        enhancedImages,
      },
      seoScore: seoAnalysis.seoScore,
      tokenUsage,
      processingTime,
    };

    console.log(`[ChatGPT Review] Completed in ${processingTime}ms`);

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[ChatGPT Review] Error:", error);
    return NextResponse.json(
      {
        error: "ChatGPT review failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: error?.statusCode || 500 }
    );
  }
}
