import { NextRequest, NextResponse } from "next/server";
import { markNotificationAsRead, dismissNotification } from "@/lib/notification-service";
import { requireTeamMember, requireAdmin, runWithAuthenticatedTeamContext } from "@/lib/api/auth";
import { runWithSystemContext } from "@/lib/tenant-context";

/**
 * Resolve auth context for per-notification endpoints.
 * Same two-path strategy as the collection route: full requireTeamMember for team users,
 * requireAdmin fallback (userId only, teamId = null) for global admins with no team.
 */
async function withNotificationAuth<T>(
  request: NextRequest,
  fn: (auth: { userId: number; teamId: number | null; role: string }) => Promise<T>,
): Promise<T> {
  let auth: { userId: number; teamId: number; role: string };
  try {
    auth = await requireTeamMember(request);
  } catch (err: any) {
    if (err.statusCode === 403 && err.message === "Access denied: User must be assigned to a team") {
      const userId = await requireAdmin(request);
      return await runWithSystemContext(
        `team-less platform admin notification request by user ${userId}`,
        () => fn({ userId, teamId: null, role: "admin" }),
      );
    }
    throw err;
  }
  return await runWithAuthenticatedTeamContext(auth, () => fn(auth));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withNotificationAuth(request, async (auth) => {

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
    });
  } catch (error: any) {
    console.error("Failed to update notification:", error);
    if (error.statusCode === 401) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: error?.statusCode || 500 });
  }
}
