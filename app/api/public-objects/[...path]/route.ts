import { NextRequest, NextResponse } from "next/server";
import { objectStorageClient } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await context.params;
    const filePath = path.join("/");

    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) {
      return NextResponse.json({ error: "Object storage not configured" }, { status: 500 });
    }

    const bucket = objectStorageClient.bucket(bucketId);
    const fullPath = `public/${filePath}`;
    const file = bucket.file(fullPath);

    const [exists] = await file.exists();
    if (!exists) {
      console.error(`[PUBLIC_OBJECTS] File not found: ${fullPath}`);
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || "application/octet-stream";
    const fileSize = Number(metadata.size ?? 0);

    // ETag from GCS md5Hash, or fallback to generation id
    const etag = metadata.md5Hash
      ? `"${metadata.md5Hash}"`
      : metadata.generation
        ? `"${metadata.generation}"`
        : null;

    // Conditional request — serve 304 if browser already has the current version
    if (etag) {
      const ifNoneMatch = request.headers.get("if-none-match");
      if (ifNoneMatch === etag) {
        return new NextResponse(null, {
          status: 304,
          headers: {
            ETag: etag,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
    }

    // Range request support — essential for video seeking without full re-download
    const rangeHeader = request.headers.get("range");
    if (rangeHeader && fileSize > 0) {
      const match = rangeHeader.match(/^bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const stream = file.createReadStream({ start, end });
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);

        const headers: Record<string, string> = {
          "Content-Type": contentType,
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Content-Length": chunkSize.toString(),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
        };
        if (etag) headers.ETag = etag;

        return new NextResponse(buffer, { status: 206, headers });
      }
    }

    // Full file response
    const stream = file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": buffer.length.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    if (etag) headers.ETag = etag;

    return new NextResponse(buffer, { headers });
  } catch (error) {
    console.error("[PUBLIC_OBJECTS] Error serving file:", error);
    return NextResponse.json({ error: "Failed to serve file" }, { status: 500 });
  }
}
