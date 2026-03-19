import { NextRequest, NextResponse } from "next/server";
import { objectStorageClient } from "@/lib/storage";
import { requireTeamMember } from "@/lib/api/auth";

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const formData = await request.formData();
    const file = formData.get("logo") as File;
    
    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Validate file type - explicitly allow only PNG, JPG, JPEG, WebP
    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      return NextResponse.json(
        { error: "File must be PNG, JPG, or WebP format" },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File size must be less than 5MB" },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate unique filename
    const timestamp = Date.now();
    const originalName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const filename = `logo-${timestamp}-${originalName}`;
    const objectName = `public/company-logos/${filename}`;

    // Upload to Replit Object Storage
    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const storageFile = bucket.file(objectName);
    
    await storageFile.save(buffer, {
      contentType: file.type,
      metadata: {
        cacheControl: "public, max-age=31536000",
      },
    });

    // Return public URL
    const publicUrl = `/api/public-objects/company-logos/${filename}`;

    console.log(`✅ Company logo uploaded: ${publicUrl}`);

    return NextResponse.json({
      success: true,
      url: publicUrl,
      filename,
    });
  } catch (error: any) {
    console.error("❌ Logo upload failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to upload logo" },
      { status: 500 }
    );
  }
}
