import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articleAssets } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { deleteFromStorage } from "@/lib/storage";
import { z } from "zod";
import { requireTeamMember } from "@/lib/api/auth";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const { id: idParam } = await params;
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "Invalid asset ID" },
        { status: 400 }
      );
    }

    // Get asset details before deleting
    const [asset] = await db
      .select()
      .from(articleAssets)
      .where(eq(articleAssets.id, id));

    if (!asset) {
      return NextResponse.json(
        { error: "Asset not found" },
        { status: 404 }
      );
    }

    // Extract key from storage URL
    const urlParts = asset.storageUrl.split('/');
    const key = urlParts.slice(-3).join('/'); // Get last 3 parts: articleId/type/filename

    try {
      // Delete from object storage
      await deleteFromStorage(key);
    } catch (storageError) {
      console.warn("⚠️  Failed to delete from storage (may not exist):", storageError);
      // Continue with database deletion even if storage deletion fails
    }

    // Delete from database
    await db
      .delete(articleAssets)
      .where(eq(articleAssets.id, id));

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
    const { userId, teamId } = await requireTeamMember(request);
    const { id: idParam } = await params;
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "Invalid asset ID" },
        { status: 400 }
      );
    }

    const [asset] = await db
      .select()
      .from(articleAssets)
      .where(eq(articleAssets.id, id));

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
    const { userId, teamId } = await requireTeamMember(request);
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

    // Check if asset exists
    const [existingAsset] = await db
      .select()
      .from(articleAssets)
      .where(eq(articleAssets.id, id));

    if (!existingAsset) {
      return NextResponse.json(
        { error: "Asset not found" },
        { status: 404 }
      );
    }

    // Update asset
    const [updatedAsset] = await db
      .update(articleAssets)
      .set({
        ...validatedData,
      })
      .where(eq(articleAssets.id, id))
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
