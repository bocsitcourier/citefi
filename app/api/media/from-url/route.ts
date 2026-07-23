import { NextRequest, NextResponse } from "next/server";
import { uploadMedia } from "@/lib/storage";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { validateExternalUrl } from "@/lib/url-validation";
import sharp from "sharp";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  try {
    await requireTeamMember(request);

    const body = await request.json();
    const { url, articleId, altText, assetType } = body;

    if (!url) {
      return NextResponse.json(
        { error: "No URL provided" },
        { status: 400 }
      );
    }

    try {
      validateExternalUrl(url);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Invalid URL" },
        { status: 400 }
      );
    }

    if (!assetType || !['image', 'audio', 'video'].includes(assetType)) {
      return NextResponse.json(
        { error: "Invalid asset type. Must be 'image', 'audio', or 'video'" },
        { status: 400 }
      );
    }

    console.log(`📥 Fetching ${assetType} from URL:`, url);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` },
        { status: 400 }
      );
    }

    // Extract filename from URL or generate one
    let fileName = url.split('/').pop()?.split('?')[0] || `media-${Date.now()}`;
    let processedBuffer = buffer;
    let finalContentType = contentType;
    let metadata: Record<string, any> | undefined;

    // Process based on asset type
    if (assetType === 'image') {
      try {
        const image = sharp(buffer);
        const imageMetadata = await image.metadata();

        metadata = {
          width: imageMetadata.width,
          height: imageMetadata.height,
          format: imageMetadata.format,
          originalSize: buffer.length,
          sourceUrl: url,
        };

        // Convert to WebP for optimization
        processedBuffer = await image
          .webp({ quality: 85 })
          .toBuffer();

        fileName = fileName.replace(/\.[^.]+$/, '.webp');
        finalContentType = 'image/webp';
      } catch (err: any) {
        console.error("❌ Image processing failed:", err);
        return NextResponse.json(
          { error: "Failed to process image" },
          { status: 400 }
        );
      }
    } else {
      // For audio and video, save as-is
      metadata = {
        mimeType: contentType,
        originalSize: buffer.length,
        sourceUrl: url,
      };
    }

    // Verify the article belongs to this team before allowing upload association
    const parsedArticleId = articleId ? parseInt(articleId) : undefined;
    if (parsedArticleId) {
      const [articleCheck] = await db
        .select({ id: articles.id })
        .from(articles)
        .where(and(eq(articles.id, parsedArticleId), eq(articles.teamId, teamId)))
        .limit(1);
      if (!articleCheck) {
        return NextResponse.json({ error: "Article not found" }, { status: 404 });
      }
    }

    const publicUrl = await uploadMedia({
      fileData: processedBuffer,
      fileName,
      contentType: finalContentType,
      assetType,
      articleId: parsedArticleId,
      altText: altText || undefined,
      metadata,
    });

    return NextResponse.json({
      success: true,
      url: publicUrl,
      assetType,
      metadata,
    });

  } catch (error: any) {
    console.error("❌ Media import from URL error:", error);
    return NextResponse.json(
      { 
        error: "Failed to import media from URL",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: error?.statusCode || 500 }
    );
  }
}
