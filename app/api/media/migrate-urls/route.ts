import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, articleAssets } from "@/shared/schema";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

// Migrate old object storage URLs to new API route format
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
    
    if (!bucketId) {
      return NextResponse.json(
        { error: "DEFAULT_OBJECT_STORAGE_BUCKET_ID not set" },
        { status: 500 }
      );
    }

    const oldUrlPattern1 = `https://replit-objstore-${bucketId}.id.repl.co/public/`;
    const oldUrlPattern2 = `https://${bucketId}.id.repl.co/public/`;
    const newUrlPattern = `/api/public-objects/`;

    // Update articles table - hero image URLs (pattern 1)
    await db.execute(sql.raw(`
      UPDATE articles 
      SET hero_image_url = REPLACE(hero_image_url, 
        '${oldUrlPattern1}',
        '${newUrlPattern}'
      )
      WHERE hero_image_url LIKE '${oldUrlPattern1}%'
    `));

    // Update articles table - hero image URLs (pattern 2)
    await db.execute(sql.raw(`
      UPDATE articles 
      SET hero_image_url = REPLACE(hero_image_url, 
        '${oldUrlPattern2}',
        '${newUrlPattern}'
      )
      WHERE hero_image_url LIKE '${oldUrlPattern2}%'
    `));

    // Update article_assets table - storage URLs (pattern 1)
    await db.execute(sql.raw(`
      UPDATE article_assets 
      SET storage_url = REPLACE(storage_url, 
        '${oldUrlPattern1}',
        '${newUrlPattern}'
      )
      WHERE storage_url LIKE '${oldUrlPattern1}%'
    `));

    // Update article_assets table - storage URLs (pattern 2)
    await db.execute(sql.raw(`
      UPDATE article_assets 
      SET storage_url = REPLACE(storage_url, 
        '${oldUrlPattern2}',
        '${newUrlPattern}'
      )
      WHERE storage_url LIKE '${oldUrlPattern2}%'
    `));

    // Get updated counts
    const articlesResult = await db.execute(sql.raw(`
      SELECT COUNT(*) as count FROM articles WHERE hero_image_url LIKE '${newUrlPattern}%'
    `));
    
    const assetsResult = await db.execute(sql.raw(`
      SELECT COUNT(*) as count FROM article_assets WHERE storage_url LIKE '${newUrlPattern}%'
    `));

    return NextResponse.json({
      success: true,
      message: "URLs migrated successfully",
      stats: {
        articlesWithNewUrls: articlesResult.rows?.[0]?.count || 0,
        assetsWithNewUrls: assetsResult.rows?.[0]?.count || 0,
      },
    });
  } catch (error) {
    console.error("[MIGRATE_URLS] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to migrate URLs",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
