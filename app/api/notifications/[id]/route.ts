import { NextRequest, NextResponse } from "next/server";
import { markNotificationAsRead, dismissNotification } from "@/lib/notification-service";
import { requireTeamMember, requireAdmin } from "@/lib/api/auth";

/**
 * Resolve auth context for per-notification endpoints.
 * Same two-path strategy as the collection route: full requireTeamMember for team users,
 * requireAdmin fallback (userId only, teamId = null) for global admins with no team.
 */
async function resolveNotificationAuth(request: NextRequest): Promise<{ userId: number; teamId: number | null; role: string }> {
  try {
    const auth = await requireTeamMember(request);
    return auth;
  } catch (err: any) {
    if (err.statusCode === 403 && err.message === "Access denied: User must be assigned to a team") {
      const userId = await requireAdmin(request);
      return { userId, teamId: null, role: "admin" };
    }
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await resolveNotificationAuth(request);

    const { id } = await params;
    const notificationId = parseInt(id, 10);
    if (isNaN(notificationId)) {
      return NextResponse.json({ error: "Invalid notification ID" }, { status: 400 });
    }

    let body: { action?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { action } = body;

    if (action === "read") {
      await markNotificationAsRead(notificationId, auth.teamId, auth.userId);
      return NextResponse.json({ success: true });
    }

    if (action === "dismiss") {
      await dismissNotification(notificationId, auth.teamId, auth.userId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Failed to update notification:", error);
    if (error.statusCode === 401) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: error?.statusCode || 500 });
  }
}
