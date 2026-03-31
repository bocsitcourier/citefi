import { NextRequest, NextResponse } from "next/server";
import { getUnreadNotifications, getAllNotifications, markAllAsRead, getUnreadCount, dismissAllNotifications } from "@/lib/notification-service";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTeamMember(request);
    if (!auth.teamId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unread") === "true";
    const countOnly = searchParams.get("count") === "true";
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    if (countOnly) {
      const count = await getUnreadCount(auth.teamId);
      return NextResponse.json({ count });
    }

    const notifications = unreadOnly
      ? await getUnreadNotifications(auth.teamId, limit)
      : await getAllNotifications(auth.teamId, limit);

    return NextResponse.json({ notifications });
  } catch (error: any) {
    console.error("Failed to fetch notifications:", error);
    if (error.statusCode === 401) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTeamMember(request);
    if (!auth.teamId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    if (action === "mark_all_read") {
      await markAllAsRead(auth.teamId);
      return NextResponse.json({ success: true });
    }

    if (action === "dismiss_all") {
      await dismissAllNotifications(auth.teamId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Failed to process notification action:", error);
    if (error.statusCode === 401) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
