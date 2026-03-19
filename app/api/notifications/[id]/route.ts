import { NextRequest, NextResponse } from "next/server";
import { markNotificationAsRead, dismissNotification } from "@/lib/notification-service";
import { requireTeamMember } from "@/lib/api/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireTeamMember(request);
    if (!auth.teamId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const notificationId = parseInt(id, 10);
    if (isNaN(notificationId)) {
      return NextResponse.json({ error: "Invalid notification ID" }, { status: 400 });
    }

    const body = await request.json();
    const { action } = body;

    if (action === "read") {
      await markNotificationAsRead(notificationId, auth.teamId);
      return NextResponse.json({ success: true });
    }

    if (action === "dismiss") {
      await dismissNotification(notificationId, auth.teamId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Failed to update notification:", error);
    if (error.statusCode === 401) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
