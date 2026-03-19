import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorLogs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { objectStorageClient } from "@/lib/storage";

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("screenshot") as File | null;
    const errorMessage = formData.get("errorMessage") as string || "Unknown client error";
    const errorStack = formData.get("stackTrace") as string || "";
    const pageUrl = formData.get("pageUrl") as string || "";

    if (!file) {
      return NextResponse.json({ error: "No screenshot provided" }, { status: 400 });
    }

    let screenshotUrl: string | undefined;

    // Upload screenshot to object storage if bucket is configured
    if (BUCKET_ID) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const timestamp = Date.now();
      const objectName = `public/error-screenshots/${timestamp}.png`;

      const bucket = objectStorageClient.bucket(BUCKET_ID);
      const storageFile = bucket.file(objectName);
      await storageFile.save(buffer, {
        contentType: "image/png",
        metadata: { cacheControl: "public, max-age=86400" },
      });

      screenshotUrl = `/api/public-objects/error-screenshots/${timestamp}.png`;
    }

    // Insert error log with screenshot
    const [inserted] = await db.insert(errorLogs).values({
      errorType: "SYSTEM",
      errorMessage: `[CLIENT ERROR] ${errorMessage}${pageUrl ? ` — Page: ${pageUrl}` : ""}`,
      stackTrace: errorStack || undefined,
      severity: "error",
      screenshotUrl,
      resolved: 0,
    }).returning({ id: errorLogs.id });

    // Fire Slack notification if configured
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (webhookUrl) {
      const blocks: unknown[] = [
        {
          type: "header",
          text: { type: "plain_text", text: ":x: CLIENT ERROR: UI Crash Detected", emoji: true },
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
      if (screenshotUrl) {
        const absoluteUrl = `${process.env.NEXTAUTH_URL || ""}${screenshotUrl}`;
        blocks.push({
          type: "image",
          title: { type: "plain_text", text: "UI Screenshot at time of crash" },
          image_url: absoluteUrl,
          alt_text: "Error screenshot",
        });
      }
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `ApexContent Engine • ${new Date().toISOString()}` }],
      });

      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      }).catch(() => {});
    }

    return NextResponse.json({ success: true, errorLogId: inserted?.id, screenshotUrl });
  } catch (err) {
    console.error("[ERROR_SCREENSHOT] Failed:", err);
    return NextResponse.json({ error: "Failed to capture error screenshot" }, { status: 500 });
  }
}
