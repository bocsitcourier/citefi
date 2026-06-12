import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public frontend routes (no authentication required)
const PUBLIC_ROUTES = [
  "/login",
  "/signup",
  "/verify-2fa",
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/verify-2fa",
  "/api/auth/send-email-code",
  "/api/health",
  "/api/public-objects",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // API routes enforce auth in their own handlers (returning JSON 401/403).
  // We don't redirect them here — that would break fetch() error handling.
  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // Protected page routes (/admin, /dashboard): require an auth cookie.
  // Full JWT/session validation still happens server-side in the route/API
  // handlers; this is a fast edge gate that prevents rendering the page shell
  // for unauthenticated visitors. The token never leaves the HttpOnly cookie.
  const hasAuthCookie = Boolean(request.cookies.get("auth_token")?.value);
  if (!hasAuthCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    "/api/:path*",
    "/admin/:path*",
    "/dashboard/:path*",
    "/login",
    "/signup",
    "/verify-2fa",
  ],
};
