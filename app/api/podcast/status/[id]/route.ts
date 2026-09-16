import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { withAuthenticatedTeamContext } from "@/lib/api/auth";
import { resolvePodcastDurationProvenance } from "@/lib/podcast-duration-provenance";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withAuthenticatedTeamContext(request, async ({ userId, teamId }) => {
    const { id: idParam } = await params;
    const articleId = parseInt(idParam);
    
    if (isNaN(articleId)) {
      return NextResponse.json(
        { error: "Invalid article ID" },
        { status: 400 }
      );
    }
    
    const [article] = await db
      .select({
        id: articles.id,
        podcastStatus: articles.podcastStatus,
        podcastUrl: articles.podcastUrl,
        podcastDuration: articles.podcastDuration,
        podcastGeneratedAt: articles.podcastGeneratedAt,
        podcastScriptJson: articles.podcastScriptJson,
      })
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.teamId, teamId)))
      .limit(1);
    
    if (!article) {
      return NextResponse.json(
        { error: "Article not found" },
        { status: 404 }
      );
    }
    
    const durationProvenance = resolvePodcastDurationProvenance(
      article.podcastScriptJson,
      article.podcastDuration,
    );

    return NextResponse.json({
      articleId: article.id,
      status: article.podcastStatus || 'none',
      url: article.podcastUrl,
      duration: durationProvenance.seconds,
      durationSource: durationProvenance.source,
      generatedAt: article.podcastGeneratedAt,
      script: article.podcastScriptJson,
    });
    });
  } catch (error: any) {
    console.error("Error fetching podcast status:", error);
    return NextResponse.json(
      { error: "Failed to fetch podcast status" },
      { status: error?.statusCode || 500 }
    );
  }
}
