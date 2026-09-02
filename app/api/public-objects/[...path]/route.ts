import { NextRequest, NextResponse } from "next/server";
import { objectStorageClient } from "@/lib/storage";
import { requireTeamMember } from "@/lib/api/auth";
import { systemDb } from "@/lib/db";
import {
  articleAssets,
  articles,
  publishingJobs,
  socialPostAssets,
  socialPosts,
} from "@/shared/schema";
import { and, eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await context.params;
    const filePath = path.join("/");
    if (
      !filePath ||
      filePath.includes("..") ||
      filePath.startsWith("/") ||
      filePath.includes("\\")
    ) {
      return NextResponse.json({ error: "Invalid object path" }, { status: 400 });
    }

    if (!process.env.DO_SPACES_BUCKET) {
      return NextResponse.json({ error: "Object storage not configured" }, { status: 500 });
    }

    const requestedUrl = `/api/public-objects/${filePath}`;
    const [articleAsset, socialAsset] = await Promise.all([
      systemDb.select({
        teamId: articles.teamId,
        articleId: articles.id,
      }).from(articleAssets)
        .innerJoin(articles, eq(articles.id, articleAssets.articleId))
        .where(eq(articleAssets.storageUrl, requestedUrl))
        .limit(1),
      systemDb.select({
        teamId: socialPosts.teamId,
        socialPostId: socialPosts.id,
      }).from(socialPostAssets)
        .innerJoin(socialPosts, eq(socialPosts.id, socialPostAssets.socialPostId))
        .where(eq(socialPostAssets.storageUrl, requestedUrl))
        .limit(1),
    ]);
    const owner = articleAsset[0] ?? socialAsset[0];
    if (!owner?.teamId) {
      // Generic uploads and untracked storage keys are never anonymously
      // enumerable, even if somebody guesses the object name.
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    let publiclyPublished = false;
    if (!filePath.startsWith("private/")) {
      const published = "articleId" in owner
        ? await systemDb.select({ id: publishingJobs.id }).from(publishingJobs)
            .where(and(
              eq(publishingJobs.teamId, owner.teamId),
              eq(publishingJobs.articleId, owner.articleId),
              inArray(publishingJobs.status, ["delivered", "published"])
            )).limit(1)
        : await systemDb.select({ id: publishingJobs.id }).from(publishingJobs)
            .where(and(
              eq(publishingJobs.teamId, owner.teamId),
              eq(publishingJobs.socialPostId, owner.socialPostId),
              inArray(publishingJobs.status, ["delivered", "published"])
            )).limit(1);
      publiclyPublished = published.length > 0;
    }

    if (!publiclyPublished) {
      try {
        const auth = await requireTeamMember(request);
        if (auth.teamId !== owner.teamId) {
          return NextResponse.json({ error: "File not found" }, { status: 404 });
        }
      } catch {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
    }
    const cacheControl = publiclyPublished
      ? "public, max-age=31536000, immutable"
      : "private, no-store";

    const bucket   = objectStorageClient.bucket(process.env.DO_SPACES_BUCKET);
    const fullPath = filePath.startsWith("private/") ? filePath : `public/${filePath}`;
    const file     = bucket.file(fullPath);

    let metadata: { contentType: string; size: number; md5Hash?: string };
    try {
      const [meta] = await file.getMetadata();
      metadata = meta;
    } catch (err: any) {
      const code = err?.code ?? err?.$metadata?.httpStatusCode ?? err?.response?.statusCode;
      if (code === 404 || code === "404" || err?.name === "NotFound") {
        console.error(`[PUBLIC_OBJECTS] File not found: ${fullPath}`);
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      throw err;
    }

    const contentType = metadata.contentType || "application/octet-stream";
    const fileSize    = Number(metadata.size ?? 0);
    const etag        = metadata.md5Hash ? `"${metadata.md5Hash}"` : null;

    // Conditional request — 304 if browser already has it
    if (etag) {
      const ifNoneMatch = request.headers.get("if-none-match");
      if (ifNoneMatch === etag) {
        return new NextResponse(null, {
          status: 304,
          headers: {
            ETag: etag,
            "Cache-Control": cacheControl,
          },
        });
      }
    }

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

    // Range request — required for video seeking
    const rangeHeader = request.headers.get("range");
    if (rangeHeader && fileSize > 0) {
      const match = rangeHeader.match(/^bytes=(\d+)-(\d*)/);
      if (match) {
        const start     = parseInt(match[1]!, 10);
        const end       = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const nodeStream = file.createReadStream({ start, end });
        const webStream  = nodeStreamToWebStream(nodeStream);

        const headers: Record<string, string> = {
          "Content-Type":   contentType,
          "Content-Range":  `bytes ${start}-${end}/${fileSize}`,
          "Content-Length": chunkSize.toString(),
          "Accept-Ranges":  "bytes",
          "Cache-Control":  cacheControl,
        };
        if (etag) headers.ETag = etag;

        return new NextResponse(webStream, { status: 206, headers });
      }
    }

    // Full file — streamed
    const nodeStream = file.createReadStream();
    const webStream  = nodeStreamToWebStream(nodeStream);

    const headers: Record<string, string> = {
      "Content-Type":  contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
    };
    if (fileSize > 0) headers["Content-Length"] = fileSize.toString();
    if (etag) headers.ETag = etag;

    return new NextResponse(webStream, { headers });
  } catch (error) {
    console.error("[PUBLIC_OBJECTS] Error serving file:", error);
    return NextResponse.json({ error: "Failed to serve file" }, { status: 500 });
  }
}
