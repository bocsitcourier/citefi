import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articleAssets } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { deleteFromStorage } from "@/lib/storage";
import { z } from "zod";
import { requireTeamMember } from "@/lib/api/auth";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id: idParam } = await params;
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "Invalid asset ID" },
        { status: 400 }
      );
    }

    // TEAM ISOLATION: only fetch asset belonging to authenticated team
    const [asset] = await db
      .select()
      .from(articleAssets)
      .where(and(eq(articleAssets.id, id), eq(articleAssets.teamId, teamId)));

    if (!asset) {
      return NextResponse.json(
        { error: "Asset not found" },
        { status: 404 }
      );
    }

    // Extract key from storage URL
    const urlParts = asset.storageUrl.split('/');
    const key = urlParts.slice(-3).join('/');

    try {
      await deleteFromStorage(key);
    } catch (storageError) {
      console.warn("⚠️  Failed to delete from storage (may not exist):", storageError);
    }

    // TEAM ISOLATION: double-filter on delete
    await db
      .delete(articleAssets)
      .where(and(eq(articleAssets.id, id), eq(articleAssets.teamId, teamId)));

    console.log(`🗑️  Deleted asset ${id}: ${asset.assetType}`);

    return NextResponse.json({
      success: true,
      message: "Asset deleted successfully",
    });

  } catch (error) {
    console.error("❌ Media delete error:", error);
    return NextResponse.json(
      {
        error: "Failed to delete media asset",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id: idParam } = await params;
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "Invalid asset ID" },
        { status: 400 }
      );
    }

    // TEAM ISOLATION: filter by both id and teamId
    const [asset] = await db
      .select()
      .from(articleAssets)
      .where(and(eq(articleAssets.id, id), eq(articleAssets.teamId, teamId)));

    if (!asset) {
      return NextResponse.json(
        { error: "Asset not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      asset,
    });

  } catch (error) {
    console.error("❌ Media get error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch media asset",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

const updateAssetSchema = z.object({
  altText: z.string().optional(),
  imagePromptUsed: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id: idParam } = await params;
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "Invalid asset ID" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validatedData = updateAssetSchema.parse(body);

    // TEAM ISOLATION: check ownership before update
    const [existingAsset] = await db
      .select()
      .from(articleAssets)
      .where(and(eq(articleAssets.id, id), eq(articleAssets.teamId, teamId)));

    if (!existingAsset) {
      return NextResponse.json(
        { error: "Asset not found" },
        { status: 404 }
      );
    }

    // TEAM ISOLATION: double-filter on update
    const [updatedAsset] = await db
      .update(articleAssets)
      .set({ ...validatedData })
      .where(and(eq(articleAssets.id, id), eq(articleAssets.teamId, teamId)))
      .returning();

    console.log(`✅ Updated asset ${id}`);

    return NextResponse.json({
      success: true,
      asset: updatedAsset,
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid request data",
          details: error.errors
        },
        { status: 400 }
      );
    }

    console.error("❌ Media update error:", error);
    return NextResponse.json(
      {
        error: "Failed to update media asset",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
