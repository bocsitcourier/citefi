import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articleAssets, articles, socialPosts } from "@/shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

// Helper: Convert any absolute URL to a relative /api/public-objects/ path.
function normalizeMediaUrl(url: string | null): string | null {
  if (!url) return null;

  if (url.startsWith('/api/public-objects/')) return url;

  // Any absolute URL routing through /api/public-objects/ (riker.replit.dev, etc.)
  const publicObjectsMatch = url.match(/\/api\/public-objects\/(.+)$/);
  if (publicObjectsMatch) return `/api/public-objects/${publicObjectsMatch[1]}`;

  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (bucketId && url.includes(`${bucketId}.id.repl.co/public/`)) {
    return `/api/public-objects/${url.split('/public/')[1]}`;
  }
  if (bucketId && url.includes(`storage.googleapis.com/${bucketId}/public/`)) {
    return `/api/public-objects/${url.split('/public/')[1]}`;
  }
  if (url.includes('oaidalleapiprodscus.blob.core.windows.net')) return null;

  return url;
}

export async function GET(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const searchParams = request.nextUrl.searchParams;
    const articleId = searchParams.get('articleId');
    const assetType = searchParams.get('type') as 'image' | 'audio' | 'video' | null;
    const limit = parseInt(searchParams.get('limit') || '100');

    let assets: any[] = [];

    // Fetch from articleAssets
    let query = db.select({
      id: articleAssets.id,
      articleId: articleAssets.articleId,
      assetType: articleAssets.assetType,
      storageUrl: articleAssets.storageUrl,
      altText: articleAssets.altText,
      fileFormat: articleAssets.fileFormat,
      metadataJson: articleAssets.metadataJson,
      imagePromptUsed: articleAssets.imagePromptUsed,
      createdAt: articleAssets.createdAt,
      articleTitle: articles.chosenTitle,
      heroImageUrl: articles.heroImageUrl,
    })
    .from(articleAssets)
    .leftJoin(articles, eq(articleAssets.articleId, articles.id))
    .orderBy(desc(articleAssets.createdAt))
    .limit(limit);

    // Apply filters for articleAssets
    const filters: any[] = [];
    if (articleId) {
      filters.push(eq(articleAssets.articleId, parseInt(articleId)));
    }
    if (assetType) {
      filters.push(eq(articleAssets.assetType, assetType));
    }

    const rawAssets = filters.length > 0
      ? await query.where(filters[0])
      : await query;

    // Normalize URLs and mark assets as hero
    const normalizedAssets = rawAssets.map(asset => {
      const normalizedUrl = normalizeMediaUrl(asset.storageUrl);
      const normalizedHeroUrl = normalizeMediaUrl(asset.heroImageUrl);
      return {
        ...asset,
        storageUrl: normalizedUrl || asset.storageUrl,
        isHero: normalizedHeroUrl && normalizedUrl === normalizedHeroUrl,
        source: 'article',
      };
    });

    assets.push(...normalizedAssets);

    // Also fetch social videos if type is 'video' or no type specified
    if (assetType === 'video' || !assetType) {
      const socialVideos = await db
        .select({
          id: socialPosts.id,
          socialPostId: socialPosts.id,
          title: socialPosts.title,
          topic: socialPosts.topic,
          location: socialPosts.location,
          companyName: socialPosts.companyName,
          videoUrl: socialPosts.videoUrl,
          videoStatus: socialPosts.videoStatus,
          videoDuration: socialPosts.videoDuration,
          createdAt: socialPosts.createdAt,
        })
        .from(socialPosts)
        .where(eq(socialPosts.videoStatus, 'READY'))
        .orderBy(desc(socialPosts.createdAt))
        .limit(limit);

      // Transform social videos to match asset interface
      const socialVideoAssets = socialVideos
        .filter(v => v.videoUrl) // Only include videos with URLs
        .map(video => ({
          id: video.id + 100000, // Offset IDs to avoid conflicts
          articleId: null,
          socialPostId: video.socialPostId,
          assetType: 'video' as const,
          storageUrl: normalizeMediaUrl(video.videoUrl) || video.videoUrl,
          altText: `${video.title || video.topic} - ${video.location}`,
          fileFormat: 'mp4',
          metadataJson: {
            duration: video.videoDuration,
            companyName: video.companyName,
          },
          imagePromptUsed: null,
          createdAt: video.createdAt,
          articleTitle: video.title || video.topic,
          heroImageUrl: null,
          isHero: false,
          source: 'social',
        }));

      assets.push(...socialVideoAssets);
    }

    // Sort all assets by creation date
    assets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply limit to combined results
    assets = assets.slice(0, limit);

    return NextResponse.json({
      success: true,
      assets,
      count: assets.length,
    });

  } catch (error: any) {
    const status = error?.statusCode ?? 500;
    if (status !== 500) {
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("❌ Media list error:", error);
    return NextResponse.json(
      { 
        error: "Failed to fetch media assets",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
