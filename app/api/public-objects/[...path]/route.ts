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

    // Single GCS call — getMetadata() throws a 404-style error if the file
    // doesn't exist, so file.exists() is a redundant round-trip we can skip.
    let metadata: Record<string, any>;
    try {
      const [meta] = await file.getMetadata();
      metadata = meta as Record<string, any>;
    } catch (err: any) {
      const code = err?.code ?? err?.response?.statusCode;
      if (code === 404 || code === "404") {
        console.error(`[PUBLIC_OBJECTS] File not found: ${fullPath}`);
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      throw err;
    }

    const contentType = (metadata.contentType as string) || "application/octet-stream";
    const fileSize = Number(metadata.size ?? 0);

    // ETag from GCS md5Hash or generation id
    const etag = metadata.md5Hash
      ? `"${metadata.md5Hash}"`
      : metadata.generation
        ? `"${metadata.generation}"`
        : null;

    // Conditional request — 304 if browser already has it
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

    // ── Helpers ────────────────────────────────────────────────────────────────

    /** Pipe a Node.js Readable into a Web ReadableStream without buffering. */
    function nodeStreamToWebStream(nodeStream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          nodeStream.on("data", (chunk: Buffer | string) => {
            controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          });
          nodeStream.on("end", () => controller.close());
          nodeStream.on("error", (err) => controller.error(err));
        },
        cancel() {
          if (typeof (nodeStream as any).destroy === "function") {
            (nodeStream as any).destroy();
          }
        },
      });
    }

    // ── Range request — required for video seeking ─────────────────────────────
    const rangeHeader = request.headers.get("range");
    if (rangeHeader && fileSize > 0) {
      const match = rangeHeader.match(/^bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1]!, 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const nodeStream = file.createReadStream({ start, end });
        const webStream = nodeStreamToWebStream(nodeStream);

        const headers: Record<string, string> = {
          "Content-Type": contentType,
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Content-Length": chunkSize.toString(),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
        };
        if (etag) headers.ETag = etag;

        return new NextResponse(webStream, { status: 206, headers });
      }
    }

    // ── Full file — streamed, no buffering ─────────────────────────────────────
    const nodeStream = file.createReadStream();
    const webStream = nodeStreamToWebStream(nodeStream);

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    if (fileSize > 0) headers["Content-Length"] = fileSize.toString();
    if (etag) headers.ETag = etag;

    return new NextResponse(webStream, { headers });
  } catch (error) {
    console.error("[PUBLIC_OBJECTS] Error serving file:", error);
    return NextResponse.json({ error: "Failed to serve file" }, { status: 500 });
  }
}
