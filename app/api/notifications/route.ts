import { NextRequest, NextResponse } from "next/server";
import { getUnreadNotifications, getAllNotifications, markAllAsRead, getUnreadCount, dismissAllNotifications } from "@/lib/notification-service";
import { requireTeamMember, requireAdmin } from "@/lib/api/auth";

/**
 * Resolve auth context for the notifications endpoints.
 *
 * - Team members: full requireTeamMember validation (direct + agency-admin membership checks).
 * - Global admins with no team: requireAdmin validates users.role = "admin" from DB, then
 *   returns teamId = null so the service layer uses the userId-only notification path.
 *
 * This preserves the strict team-context authorization of requireTeamMember for all users
 * that have a team, while unblocking team-less admins from seeing their signup alerts.
 */
async function resolveNotificationAuth(request: NextRequest): Promise<{ userId: number; teamId: number | null; role: string }> {
  try {
    const auth = await requireTeamMember(request);
    return auth;
  } catch (err: any) {
    // 403 with this specific message means "no team assignment" — not an unauthorized team context.
    // Any other 403/401 (stale context, suspended account, etc.) is re-thrown as-is.
    if (err.statusCode === 403 && err.message === "Access denied: User must be assigned to a team") {
      const userId = await requireAdmin(request);
      return { userId, teamId: null, role: "admin" };
    }
    throw err;
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveNotificationAuth(request);

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unread") === "true";
    const countOnly = searchParams.get("count") === "true";
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    if (countOnly) {
      const count = await getUnreadCount(auth.teamId, auth.userId);
      return NextResponse.json({ count });
    }

    const notifications = unreadOnly
      ? await getUnreadNotifications(auth.teamId, limit, auth.userId)
      : await getAllNotifications(auth.teamId, limit, auth.userId);

    return NextResponse.json({ notifications });
  } catch (error: any) {
    console.error("Failed to fetch notifications:", error);
    if (error.statusCode === 401) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: error?.statusCode || 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveNotificationAuth(request);

    const body = await request.json();
    const { action } = body;

    if (action === "mark_all_read") {
      await markAllAsRead(auth.teamId, auth.userId);
      return NextResponse.json({ success: true });
    }

    if (action === "dismiss_all") {
      await dismissAllNotifications(auth.teamId, auth.userId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Failed to process notification action:", error);
    if (error.statusCode === 401) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: error?.statusCode || 500 });
  }
}
