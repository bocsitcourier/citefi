import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { socialPosts, socialPostVariants, socialPostAssets } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const { id } = await params;
    const articleId = parseInt(id);

    if (isNaN(articleId)) {
      return NextResponse.json(
        { error: "Invalid article ID" },
        { status: 400 }
      );
    }

    // Fetch social posts for this article with variants and assets
    const posts = await db.query.socialPosts.findMany({
      where: eq(socialPosts.articleId, articleId),
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
  } catch (error) {
    console.error("Error fetching social posts for article:", error);
    return NextResponse.json(
      { error: "Failed to fetch social posts" },
      { status: 500 }
    );
  }
}
