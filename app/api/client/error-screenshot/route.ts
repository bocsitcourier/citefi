import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorLogs } from "@/shared/schema";
import { objectStorageClient } from "@/lib/storage";
import { requireAuth } from "@/lib/api/auth";

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// Per-user rate limiter: max 5 error screenshots per user per 10 minutes
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    if (!checkRateLimit(userId)) {
      return NextResponse.json(
        { error: "Too many error reports. Try again in 10 minutes." },
        { status: 429 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("screenshot") as File | null;
    const errorMessage = formData.get("errorMessage") as string || "Unknown client error";
    const errorStack = formData.get("stackTrace") as string || "";
    const pageUrl = formData.get("pageUrl") as string || "";

    if (!file) {
      return NextResponse.json({ error: "No screenshot provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Screenshot file too large (max 2 MB)" }, { status: 413 });
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Must be PNG, JPEG, or WebP." }, { status: 415 });
    }

    let screenshotUrl: string | undefined;

    if (BUCKET_ID) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const timestamp = Date.now();
      const objectName = `.private/error-screenshots/${timestamp}-${userId.slice(0, 8)}.png`;

      const bucket = objectStorageClient.bucket(BUCKET_ID);
      const storageFile = bucket.file(objectName);
      await storageFile.save(buffer, {
        contentType: file.type,
        metadata: { cacheControl: "private, no-store" },
      });

      screenshotUrl = `[private]error-screenshots/${timestamp}-${userId.slice(0, 8)}.png`;
    }

    const [inserted] = await db.insert(errorLogs).values({
      errorType: "SYSTEM",
      errorMessage: `[CLIENT ERROR] ${errorMessage}${pageUrl ? ` — Page: ${pageUrl}` : ""}`,
      stackTrace: errorStack || undefined,
      severity: "error",
      screenshotUrl,
      resolved: 0,
    }).returning({ id: errorLogs.id });

    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (webhookUrl) {
      const blocks: unknown[] = [
        {
          type: "header",
          text: { type: "plain_text", text: "CLIENT ERROR: UI Crash Detected", emoji: true },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: errorMessage.slice(0, 2000) },
        },
      ];
      if (pageUrl) {
        blocks.push({
          type: "section",
          fields: [{ type: "mrkdwn", text: `*Page:* ${pageUrl}` }],
        });
      }
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `Citefi • ${new Date().toISOString()}` }],
      });

      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      }).catch(() => {});
    }

    return NextResponse.json({ success: true, errorLogId: inserted?.id });
  } catch (err: any) {
    console.error("[ERROR_SCREENSHOT] Failed:", err);
    return NextResponse.json({ error: "Failed to capture error screenshot" }, { status: err?.statusCode || 500 });
  }
}
