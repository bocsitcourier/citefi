import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin, requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { decodeAssetSource } from "@/lib/media-library";
import { articleAssets, socialPostAssets, socialPosts } from "@/shared/schema";

type RouteContext = { params: Promise<{ identity: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    let teamId: number | null = null;
    try {
      await requireAdmin(request);
    } catch (error: any) {
      if (error?.statusCode !== 403) throw error;
      teamId = (await requireTeamMember(request)).teamId;
    }

    const source = decodeAssetSource((await context.params).identity);
    if (!source) return NextResponse.json({ error: "Invalid asset identity" }, { status: 400 });
    if (source.sourceType === "article_asset") {
      const [asset] = await db.select({ teamId: articleAssets.teamId })
        .from(articleAssets).where(eq(articleAssets.id, source.sourceId)).limit(1);
      if (!asset || (teamId !== null && asset.teamId !== teamId)) {
        return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      }
      const { POST: regenerateArticleImage } = await import("@/app/api/media/[id]/regenerate/route");
      return regenerateArticleImage(request, { params: Promise.resolve({ id: String(source.sourceId) }) });
    }

    let postId: number | null = source.sourceType === "social_video" ? source.sourceId : null;
    if (source.sourceType === "social_asset") {
      const [asset] = await db.select({ socialPostId: socialPostAssets.socialPostId })
        .from(socialPostAssets).where(eq(socialPostAssets.id, source.sourceId)).limit(1);
      postId = asset?.socialPostId ?? null;
    }
    if (!postId) return NextResponse.json({ error: "This asset cannot be regenerated" }, { status: 400 });
    const [post] = await db.select({ teamId: socialPosts.teamId, videoType: socialPosts.videoType })
      .from(socialPosts).where(eq(socialPosts.id, postId)).limit(1);
    if (!post || (teamId !== null && post.teamId !== teamId)) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const forwarded = new NextRequest(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        socialPostId: postId,
        platform: body.platform || "tiktok",
        videoType: post.videoType || "slideshow",
        force: true,
      }),
    });
    const { POST: regenerateSocialVideo } = await import("@/app/api/social/video/generate/route");
    return regenerateSocialVideo(forwarded);
  } catch (error: any) {
    const status = error?.statusCode || 500;
    if (status === 500) console.error("Asset regeneration error:", error);
    return NextResponse.json({ error: status === 500 ? "Failed to regenerate asset" : error.message }, { status });
  }
}