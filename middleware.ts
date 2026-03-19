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

  // Authentication enforcement is handled by server middleware (server/middleware/auth.ts)
  // which has access to Node.js APIs for JWT verification and session validation.
  // This Next.js middleware just passes through - it runs in Edge Runtime and can't use crypto.
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
