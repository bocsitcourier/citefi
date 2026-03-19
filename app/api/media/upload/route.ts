import { NextRequest, NextResponse } from "next/server";
import { uploadMedia } from "@/lib/storage";
import sharp from "sharp";
import { requireTeamMember } from "@/lib/api/auth";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/ogg", "video/quicktime"];

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const articleIdParam = formData.get("articleId") as string;
    const altText = formData.get("altText") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` },
        { status: 400 }
      );
    }

    let assetType: 'image' | 'audio' | 'video';
    let processedBuffer: Buffer;
    let contentType = file.type;
    let fileName = file.name;
    let metadata: Record<string, any> | undefined;

    if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
      assetType = 'image';
      
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const image = sharp(buffer);
      const imageMetadata = await image.metadata();

      metadata = {
        width: imageMetadata.width,
        height: imageMetadata.height,
        format: imageMetadata.format,
        originalSize: file.size,
      };

      processedBuffer = await image
        .webp({ quality: 85 })
        .toBuffer();

      fileName = file.name.replace(/\.[^.]+$/, '.webp');
      contentType = 'image/webp';

    } else if (ALLOWED_AUDIO_TYPES.includes(file.type)) {
      assetType = 'audio';
      
      const arrayBuffer = await file.arrayBuffer();
      processedBuffer = Buffer.from(arrayBuffer);

      metadata = {
        mimeType: file.type,
        originalSize: file.size,
      };

    } else if (ALLOWED_VIDEO_TYPES.includes(file.type)) {
      assetType = 'video';
      
      const arrayBuffer = await file.arrayBuffer();
      processedBuffer = Buffer.from(arrayBuffer);

      metadata = {
        mimeType: file.type,
        originalSize: file.size,
      };

    } else {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}` },
        { status: 400 }
      );
    }

    const articleId = articleIdParam ? parseInt(articleIdParam) : undefined;

    const publicUrl = await uploadMedia({
      fileData: processedBuffer,
      fileName,
      contentType,
      assetType,
      articleId,
      altText: altText || undefined,
      metadata,
    });

    return NextResponse.json({
      success: true,
      url: publicUrl,
      assetType,
      metadata,
    });

  } catch (error) {
    console.error("❌ Media upload error:", error);
    return NextResponse.json(
      { 
        error: "Failed to upload media",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
