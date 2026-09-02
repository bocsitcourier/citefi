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
  const add = (value?: string | null) => {
    if (!value) return;
    try { origins.add(new URL(value.includes("://") ? value : `https://${value}`).origin); } catch {}
  };
  add(process.env.APP_URL);
  add(process.env.NEXT_PUBLIC_APP_URL);
  add(process.env.REPLIT_DEV_DOMAIN);
  add(process.env.REPLIT_DOMAINS?.split(",")[0]);
  add(req.url);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) add(`${req.headers.get("x-forwarded-proto") || "https"}://${host}`);
  return origins;
}

/**
 * Enforces signed double-submit CSRF for unsafe cookie-authenticated requests.
 * Bearer credentials and safe methods are intentionally exempt.
 */
export function requireCookieCsrf(req: Request): void {
  if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return;
  const auth = req.headers.get("authorization");
  if (auth?.match(/^Bearer\s+\S+/i) && !auth.match(/^Bearer\s+(null|undefined)$/i)) return;

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

export function issueCsrfCookie(response: NextResponse): void {
  const value = crypto.randomBytes(32).toString("base64url");
  response.cookies.set(CSRF_COOKIE_NAME, `${value}.${sign(value)}`, {
    httpOnly: false,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 24 * 60 * 60,
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