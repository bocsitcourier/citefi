import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next.js 16 uses proxy.ts (not middleware.ts) for Edge-level request
// interception. The function must be named `proxy`.
//
// Security model:
//   Layer 1 (this file): Lightweight Edge gate — verifies JWT signature,
//     expiry, and admin role claim, then redirects unauthenticated browsers
//     away from /admin/* pages. Fast, no DB round-trip.
//   Layer 2 (route handlers): Authoritative enforcement — requireAdmin()
//     re-fetches the user's role from the DB on every request. Catches stale
//     JWTs (e.g. user was demoted after login) and invalid/revoked sessions.
//
// Known limitation (Replit workspace preview):
//   The Replit preview pane is a cross-site iframe. Browsers with strict
//   SameSite=Lax policies may silently drop the auth_token HttpOnly cookie
//   inside that iframe, causing this gate to redirect even though the user IS
//   logged in. This only affects the in-workspace preview pane — the deployed
//   app at replit.app, or opening the preview URL in a real tab, works fine.
//   If you hit redirect loops in the Replit preview, open the app URL in a
//   new browser tab instead.

const AUTH_COOKIE_NAME = "auth_token";
const CSRF_COOKIE_NAME = "csrf_token";
const ADMIN_PAGE_PATTERN = /^\/admin(\/|$)/;
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PUBLIC_CAPABILITY_PATHS = [
  "/api/auth/login", "/api/auth/signup", "/api/auth/forgot-password",
  "/api/auth/reset-password", "/api/auth/reset-password-token",
  "/api/auth/verify-2fa", "/api/admin/invites/accept/",
  "/api/admin/users/review",
];

// ── Edge-compatible HS256 JWT verification ──────────────────────────────────
// Cannot use `jsonwebtoken` (Node.js-only) here. Web Crypto API is supported
// on the Edge runtime and performs the same HMAC-SHA256 signature check.

function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifyAdminJwt(token: string): Promise<boolean> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return false;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const headerB64 = parts[0]!;
    const payloadB64 = parts[1]!;
    const sigB64 = parts[2]!;

    // Import the signing key
    const keyData = new TextEncoder().encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Verify HMAC-SHA256 signature over "header.payload"
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlDecode(sigB64);

    const valid = await crypto.subtle.verify("HMAC", cryptoKey, signature, signingInput);
    if (!valid) return false;

    // Decode payload and check claims
    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as {
      userId?: number;
      role?: string;
      exp?: number;
    };

    // Must not be expired
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < nowSec) return false;

    // Must carry admin role claim (requireAdmin() re-checks the DB too)
    if (payload.role !== "admin") return false;

    return true;
  } catch {
    return false;
  }
}

function extractToken(req: NextRequest): string | null {
  // Prefer Authorization: Bearer header — avoids SameSite iframe cookie issues
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const t = authHeader.slice(7).trim();
    if (t && t !== "null" && t !== "undefined") return t;
  }

  // Fall back to HttpOnly auth_token cookie
  const cookie = req.cookies.get(AUTH_COOKIE_NAME);
  if (cookie?.value) return cookie.value;

  return null;
}

// ── Main proxy function ──────────────────────────────────────────────────────

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Universal API CSRF gate. It runs before handlers (and therefore before any
  // mutation), while bearer API clients and explicit capability-token flows
  // remain unaffected.
  const bearer = request.headers.get("authorization");
  const cookieAuth = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const isCapability = PUBLIC_CAPABILITY_PATHS.some((path) => pathname.startsWith(path));
  if (pathname.startsWith("/api/") && UNSAFE_METHODS.has(request.method) &&
      cookieAuth && !bearer?.match(/^Bearer\s+\S+/i) && !isCapability) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const expectedOrigins = new Set([request.nextUrl.origin]);
    if (host) expectedOrigins.add(`${request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "")}://${host}`);
    for (const configured of [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL, process.env.REPLIT_DEV_DOMAIN]) {
      if (!configured) continue;
      try { expectedOrigins.add(new URL(configured.includes("://") ? configured : `https://${configured}`).origin); } catch {}
    }
    const csrf = request.cookies.get(CSRF_COOKIE_NAME)?.value;
    const submitted = request.headers.get("x-csrf-token");
    let valid = !!origin && expectedOrigins.has(origin) && !!csrf && csrf === submitted;
    if (valid) {
      const separator = csrf!.lastIndexOf(".");
      const secret = process.env.CSRF_SECRET || process.env.JWT_SECRET;
      if (separator < 1 || !secret) valid = false;
      else {
        const key = await crypto.subtle.importKey(
          "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
        );
        valid = await crypto.subtle.verify(
          "HMAC", key, base64UrlDecode(csrf!.slice(separator + 1)),
          new TextEncoder().encode(csrf!.slice(0, separator))
        ).catch(() => false);
      }
    }
    if (!valid) return NextResponse.json({ error: "Invalid CSRF proof" }, { status: 403 });
  }

  // Only gate /admin/* page navigations; all other paths pass through.
  if (!ADMIN_PAGE_PATTERN.test(pathname)) {
    return NextResponse.next();
  }

  const token = extractToken(request);

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const isAdmin = await verifyAdminJwt(token);
  if (!isAdmin) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/admin/:path*",
    "/dashboard/:path*",
  ],
};
