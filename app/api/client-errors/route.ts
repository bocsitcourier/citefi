import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/error-logger";

const RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = RATE_LIMIT.get(ip);
  if (!entry || now > entry.resetAt) {
    RATE_LIMIT.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  if (entry.count > MAX_PER_WINDOW) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await req.json();
    const { type = "CLIENT_ERROR", message, stack, url, digest } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const truncated = (s: string | undefined, max: number) =>
      s ? s.slice(0, max) : undefined;

    await logError({
      errorType: "SYSTEM",
      errorMessage: `[${type}] ${truncated(message, 500)}`,
      stackTrace: truncated(stack, 3000),
      severity: type === "GLOBAL_ERROR" ? "critical" : "error",
      component: "client",
      context: {
        type,
        url: truncated(url, 500),
        digest: truncated(digest, 100),
        ip,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[client-errors] Failed to log:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
