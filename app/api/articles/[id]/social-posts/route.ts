import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, socialPosts, socialPostVariants, socialPostAssets } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await params;
    const articleId = parseInt(id);

    if (isNaN(articleId)) {
      return NextResponse.json(
        { error: "Invalid article ID" },
        { status: 400 }
      );
    }

    // SECURITY: Verify the article belongs to the caller's team before exposing
    // social-post data. Without this check an authenticated user from team A could
    // read social posts for articles belonging to team B (IDOR).
    const [article] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.teamId, teamId)));

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    // Fetch social posts for this article with variants and assets
    // Double-scoped by teamId for defence-in-depth
    const posts = await db.query.socialPosts.findMany({
      where: and(
        eq(socialPosts.articleId, articleId),
        eq(socialPosts.teamId, teamId)
      ),
      with: {
        variants: {
          with: {
            assets: true,
          },
        },
        assets: true,
      },
      orderBy: (socialPosts, { desc }) => [desc(socialPosts.createdAt)],
    });

    return NextResponse.json({
      posts,
      count: posts.length,
    });
  } catch (error: any) {
    console.error("Error fetching social posts for article:", error);
    return NextResponse.json(
      { error: "Failed to fetch social posts" },
      { status: error?.statusCode || 500 }
    );
  }
}
