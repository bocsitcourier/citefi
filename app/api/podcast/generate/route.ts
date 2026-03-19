import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { generateArticlePodcast } from "@/lib/podcast-worker";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const body = await request.json();
    const { articleId, tone, duration } = body;
    
    if (!articleId) {
      return NextResponse.json(
        { error: "Article ID is required" },
        { status: 400 }
      );
    }
    
    const article = await db.query.articles.findFirst({
      where: eq(articles.id, articleId),
    });
    
    if (!article) {
      return NextResponse.json(
        { error: "Article not found" },
        { status: 404 }
      );
    }
    
    await db.update(articles)
      .set({ podcastStatus: 'pending' })
      .where(eq(articles.id, articleId));
    
    generateArticlePodcast({ articleId, tone, duration }).catch(err => {
      console.error("Podcast generation failed:", err);
    });
    
    return NextResponse.json({
      success: true,
      message: "Podcast generation started",
      articleId,
      status: "pending",
    });
  } catch (error) {
    console.error("Error starting podcast generation:", error);
    return NextResponse.json(
      { error: "Failed to start podcast generation" },
      { status: 500 }
    );
  }
}
