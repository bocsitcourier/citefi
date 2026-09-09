import { NextRequest, NextResponse } from "next/server";
import { withAuthenticatedTeamContext } from "@/lib/api/auth";
import { listCanonicalAssets, type AssetKind } from "@/lib/media-library";

function dateParam(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: NextRequest) {
  try {
    return await withAuthenticatedTeamContext(request, async ({ teamId }) => {
      const params = request.nextUrl.searchParams;
      const requestedKind = params.get("type");
      const kind = requestedKind === "image" || requestedKind === "video" || requestedKind === "audio"
        ? requestedKind as AssetKind
        : undefined;
      const result = await listCanonicalAssets({
        teamId,
        kind,
        articleId: Number(params.get("articleId")) || undefined,
        status: params.get("status") || undefined,
        from: dateParam(params.get("from")),
        to: dateParam(params.get("to")),
        cursor: params.get("cursor") || undefined,
        limit: Number(params.get("limit")) || 60,
      });
      return NextResponse.json({
        success: true,
        assets: result.items.map((asset) => ({
          ...asset,
          id: asset.assetId,
          assetType: asset.kind,
          storageUrl: asset.url,
          metadataJson: asset.metadata,
          imagePromptUsed: asset.prompt,
          articleTitle: asset.title,
          source: asset.sourceType.startsWith("article") ? "article" : "social",
        })),
        count: result.items.length,
        total: result.total,
        nextCursor: result.nextCursor,
      });
    });
  } catch (error: any) {
    const status = error?.statusCode ?? 500;
    if (status === 500) console.error("Media list error:", error);
    return NextResponse.json({ error: status === 500 ? "Failed to fetch media assets" : error.message }, { status });
  }
}