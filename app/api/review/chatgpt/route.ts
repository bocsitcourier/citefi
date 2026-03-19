import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { generateHyperlinks } from "@/lib/chatgpt-review/hyperlinker";
import { analyzeSEO } from "@/lib/chatgpt-review/seo-analyzer";
import { generateHashtags } from "@/lib/chatgpt-review/hashtag-enrichment";
import { generateSocialSnippets } from "@/lib/chatgpt-review/social-snippets";
import { enhanceImagePrompts } from "@/lib/chatgpt-review/image-enhancer";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq } from "drizzle-orm";

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

    console.log(`[ChatGPT Review] Starting review for article ${articleId}...`);

    // Execute all ChatGPT enrichment tasks in parallel for speed
    const [
      hyperlinkResult,
      seoAnalysis,
      hashtagResult,
      socialSnippets,
      enhancedImages,
    ] = await Promise.all([
      generateHyperlinks(content, coreTopic, targetUrl, competitorUrls),
      analyzeSEO(content, title, metaDescription, keywords, geographicFocus, businessName),
      generateHashtags(title, content, keywords, geographicFocus, industry),
      generateSocialSnippets(title, content, keywords, geographicFocus),
      imagePrompts.length > 0
        ? enhanceImagePrompts(imagePrompts, coreTopic, keywords, geographicFocus)
        : Promise.resolve(null),
    ]);

    console.log(`[ChatGPT Review] Enrichment complete for article ${articleId}`);
    console.log(`  - Hyperlinks: ${hyperlinkResult.totalLinks} links generated`);
    console.log(`  - SEO Score: ${seoAnalysis.seoScore}/100`);
    console.log(`  - Hashtags: ${hashtagResult.totalCount} hashtags`);
    console.log(`  - Social Snippets: OG, Twitter, LinkedIn ready`);
    if (enhancedImages) {
      console.log(`  - Images: ${enhancedImages.enhancedPrompts.length} prompts enhanced`);
    }

    // Calculate actual token usage from OpenAI responses
    const tokenUsage = {
      hyperlinks: hyperlinkResult.tokenUsage.totalTokens,
      seoAnalysis: seoAnalysis.tokenUsage.totalTokens,
      hashtags: hashtagResult.tokenUsage.totalTokens,
      socialSnippets: socialSnippets.tokenUsage.totalTokens,
      imageEnhancement: enhancedImages?.tokenUsage.totalTokens || 0,
      total: 
        hyperlinkResult.tokenUsage.totalTokens +
        seoAnalysis.tokenUsage.totalTokens +
        hashtagResult.tokenUsage.totalTokens +
        socialSnippets.tokenUsage.totalTokens +
        (enhancedImages?.tokenUsage.totalTokens || 0),
    };

    // Build meta enrichment object
    const metaEnrichment = {
      socialSnippets,
      hashtags: hashtagResult.hashtags,
      hashtagCategories: hashtagResult.categories,
      seoRecommendations: seoAnalysis.recommendations,
      readability: seoAnalysis.readability,
      localSignals: seoAnalysis.localSignals,
      enhancedImages: enhancedImages?.enhancedPrompts || [],
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
      .where(eq(articles.id, articleId));

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
  } catch (error) {
    console.error("[ChatGPT Review] Error:", error);
    return NextResponse.json(
      {
        error: "ChatGPT review failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
