import { NextRequest, NextResponse } from "next/server";
import { calculateArticleCost, calculateBatchCost, formatCost, API_COSTS, OPERATION_ESTIMATES } from "@/lib/monitoring";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const body = await request.json();
    const { numArticles = 50, includeImages = true, includePodcasts = false } = body;
    
    // Validate inputs
    if (typeof numArticles !== "number" || numArticles < 1 || numArticles > 1000) {
      return NextResponse.json(
        { error: "numArticles must be between 1 and 1000" },
        { status: 400 }
      );
    }
    
    // Calculate per-article cost breakdown
    const perArticleCost = calculateArticleCost();
    
    // Calculate batch cost
    const batchCost = calculateBatchCost(numArticles, includeImages, includePodcasts);
    
    // Build detailed breakdown
    const breakdown = {
      perArticle: {
        titleGeneration: formatCost(perArticleCost.titleGeneration),
        contentGeneration: formatCost(perArticleCost.contentGeneration),
        reviewEnhancement: formatCost(perArticleCost.reviewEnhancement),
        imageGeneration: includeImages ? formatCost(perArticleCost.imageGeneration) : "$0.0000",
        podcastGeneration: includePodcasts ? formatCost(perArticleCost.podcastGeneration) : "$0.0000",
        total: formatCost(perArticleCost.total),
      },
      batch: {
        numArticles,
        includeImages,
        includePodcasts,
        totalCost: formatCost(batchCost),
        costPerArticle: formatCost(batchCost / numArticles),
      },
      estimates: {
        totalTokensPerArticle: 
          OPERATION_ESTIMATES.ARTICLE_TITLE_GEN_INPUT +
          OPERATION_ESTIMATES.ARTICLE_TITLE_GEN_OUTPUT +
          OPERATION_ESTIMATES.ARTICLE_CONTENT_INPUT +
          OPERATION_ESTIMATES.ARTICLE_CONTENT_OUTPUT +
          OPERATION_ESTIMATES.ARTICLE_REVIEW_INPUT +
          OPERATION_ESTIMATES.ARTICLE_REVIEW_OUTPUT +
          (includePodcasts ? OPERATION_ESTIMATES.PODCAST_SCRIPT_INPUT + OPERATION_ESTIMATES.PODCAST_SCRIPT_OUTPUT : 0),
        imagesPerArticle: includeImages ? OPERATION_ESTIMATES.IMAGES_PER_ARTICLE : 0,
        podcastDurationMinutes: includePodcasts ? OPERATION_ESTIMATES.PODCAST_AVG_DURATION_MINS : 0,
      },
      apiRates: {
        gemini: {
          inputCost: `${formatCost(API_COSTS.GEMINI_FLASH_INPUT)} per 1M tokens`,
          outputCost: `${formatCost(API_COSTS.GEMINI_FLASH_OUTPUT)} per 1M tokens`,
          imageCost: `${formatCost(API_COSTS.GEMINI_FLASH_IMAGE)} per image`,
        },
        gpt4Mini: {
          inputCost: `${formatCost(API_COSTS.GPT4_MINI_INPUT)} per 1M tokens`,
          outputCost: `${formatCost(API_COSTS.GPT4_MINI_OUTPUT)} per 1M tokens`,
        },
        openaiTTS: {
          cost: `${formatCost(API_COSTS.TTS_NOVA)} per 1M characters`,
        },
      },
    };
    
    return NextResponse.json(breakdown);
  } catch (error) {
    console.error("Error calculating costs:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to calculate costs" },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return default calculation for 50 articles
  const perArticleCost = calculateArticleCost();
  const batch50Cost = calculateBatchCost(50, true, false);
  
  return NextResponse.json({
    summary: {
      costPer50Articles: formatCost(batch50Cost),
      costPerArticle: formatCost(batch50Cost / 50),
      perArticleBreakdown: {
        titleGeneration: formatCost(perArticleCost.titleGeneration),
        contentGeneration: formatCost(perArticleCost.contentGeneration),
        reviewEnhancement: formatCost(perArticleCost.reviewEnhancement),
        imageGeneration: formatCost(perArticleCost.imageGeneration),
        podcastGeneration: formatCost(perArticleCost.podcastGeneration),
      },
    },
    benchmarks: {
      "10 articles": formatCost(calculateBatchCost(10, true, false)),
      "25 articles": formatCost(calculateBatchCost(25, true, false)),
      "50 articles": formatCost(calculateBatchCost(50, true, false)),
      "100 articles": formatCost(calculateBatchCost(100, true, false)),
    },
  });
}
