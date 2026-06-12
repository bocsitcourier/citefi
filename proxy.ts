import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next.js 16 requires this file to export a `proxy` function.
// Auth gating is enforced by:
//   1. Server-side: every API route calls requireTeamMember() / requireAdmin()
//   2. Client-side: every protected page calls useAuth() and redirects to /login
//
// We intentionally do NOT gate page routes here with a cookie check because
// HttpOnly cookies are unreliable in third-party iframe contexts (e.g. the
// Replit workspace preview pane). Blocking at this layer causes a redirect loop
// when the browser silently drops SameSite cookies inside a cross-site iframe.
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/admin/:path*",
    "/dashboard/:path*",
  ],
};
