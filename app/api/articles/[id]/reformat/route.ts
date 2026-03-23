import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { addReformatJob } from "@/lib/queue";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    const articleId = parseInt(id);

    if (isNaN(articleId)) {
      return NextResponse.json(
        { error: "Invalid article ID" },
        { status: 400 }
      );
    }

    // Verify the article belongs to the authenticated team (IDOR fix)
    const [article] = await db
      .select()
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.teamId, teamId)));

    if (!article) {
      return NextResponse.json(
        { error: "Article not found" },
        { status: 404 }
      );
    }

    // Queue reformat job (runs in background - instant response)
    const jobId = await addReformatJob({ articleId });

    if (!jobId) {
      console.error(`❌ Reformat job silently rejected by queue for article ${articleId} — queue not ready`);
      return NextResponse.json(
        { error: "Reformat queue temporarily unavailable. Please try again in a few seconds." },
        { status: 503 }
      );
    }

    console.log(`🔄 Reformat job queued for article ${articleId}: ${jobId}`);

    return NextResponse.json({
      success: true,
      message: "Reformat job queued - will complete in 20-30 seconds",
      articleId,
      jobId,
    });

  } catch (error) {
    console.error("❌ Reformat queue error:", error);
    const statusCode = (error as any)?.statusCode ?? 500;
    return NextResponse.json(
      { 
        error: "Failed to queue reformat",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: statusCode }
    );
  }
}
