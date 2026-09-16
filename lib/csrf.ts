import crypto from "crypto";
import type { NextResponse } from "next/server";

export const CSRF_COOKIE_NAME = "csrf_token";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function secret(): string {
  const value = process.env.CSRF_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error("CSRF_SECRET or JWT_SECRET must be configured");
  return value;
}

function sign(value: string): string {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function allowedOrigins(req: Request): Set<string> {
  const origins = new Set<string>();
  // The request URL and explicitly configured application/preview origins are
  // trusted authorities. Never derive an allowed origin from Host or forwarded
  // headers: those values may still be attacker-controlled at the edge.
  const add = (value?: string | null) => {
    if (!value) return;
    try {
      const normalized = value.trim();
      const origin = new URL(normalized.includes("://") ? normalized : `https://${normalized}`);
      if (origin.protocol === "http:" || origin.protocol === "https:") {
        origins.add(origin.origin);
      }
    } catch {}
  };
  add(process.env.APP_URL);
  add(process.env.NEXT_PUBLIC_APP_URL);
  add(process.env.REPLIT_DEV_DOMAIN);
  for (const domain of process.env.REPLIT_DOMAINS?.split(",") || []) add(domain);
  add(req.url);
  return origins;
}

/**
 * Enforces signed double-submit CSRF for unsafe cookie-authenticated requests.
 * Callers must invoke this only after determining that the credential actually
 * selected for authentication came from the cookie. A merely present, invalid
 * Bearer header must never disable cookie CSRF checks.
 */
export function requireCookieCsrf(req: Request): void {
  if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return;

  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins(req).has(origin)) {
    const error: any = new Error("Invalid request origin");
    error.statusCode = 403;
    throw error;
  }

  const submitted = req.headers.get("x-csrf-token");
  const stored = cookie(req, CSRF_COOKIE_NAME);
  if (!submitted || !stored || !safeEqual(submitted, stored)) {
    const error: any = new Error("Invalid CSRF token");
    error.statusCode = 403;
    throw error;
  }
  const separator = stored.lastIndexOf(".");
  if (separator < 1 || !safeEqual(sign(stored.slice(0, separator)), stored.slice(separator + 1))) {
    const error: any = new Error("Invalid CSRF token");
    error.statusCode = 403;
    throw error;
  }
}

export function issueCsrfCookie(response: NextResponse, maxAgeSeconds: number = 24 * 60 * 60): void {
  const value = crypto.randomBytes(32).toString("base64url");
  response.cookies.set(CSRF_COOKIE_NAME, `${value}.${sign(value)}`, {
    httpOnly: false,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function clearCsrfCookie(response: NextResponse): void {
  response.cookies.set(CSRF_COOKIE_NAME, "", {
    httpOnly: false,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 0,
  });
}