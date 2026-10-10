import { NextRequest, NextResponse } from "next/server";
import { reviewMediaStore, sha256, validReviewMediaSignature } from "@/lib/publishing/review-media";

export const dynamic = "force-dynamic";

/** Narrow, expiring capability issued only after authorized review/dispatch.
 * Never serves an original mutable key, even if its bytes later change. */
export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams;
    const key = query.get("key") ?? "";
    if (!validReviewMediaSignature(key, query.get("expires") ?? "", query.get("signature") ?? "")) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const bytes = await reviewMediaStore.read(key);
    if (sha256(bytes) !== key.split("/").pop()!.split(".")[0]) {
      return NextResponse.json({ error: "Reviewed version unavailable" }, { status: 409 });
    }
    const ext = key.split(".").pop();
    const mime: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", ogg: "audio/ogg" };
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": mime[ext ?? ""] ?? "application/octet-stream",
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "Reviewed version unavailable" }, { status: 409 });
  }
}
