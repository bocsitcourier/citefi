import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maintenanceFlags, adminActionLogs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

const MAINTENANCE_MODE_KEY = "maintenance_mode";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const [flag] = await db
      .select()
      .from(maintenanceFlags)
      .where(eq(maintenanceFlags.flagKey, MAINTENANCE_MODE_KEY))
      .limit(1);

    if (!flag) {
      await db.insert(maintenanceFlags).values({
        flagKey: MAINTENANCE_MODE_KEY,
        flagValue: 0,
        description: "System is under maintenance. Please check back later.",
      });

      return NextResponse.json({
        isEnabled: false,
        message: "System is under maintenance. Please check back later.",
      });
    }

    return NextResponse.json({
      isEnabled: flag.flagValue === 1,
      message: flag.description || "System is under maintenance. Please check back later.",
    });
  } catch (error) {
    console.error("Get maintenance flag error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch maintenance flag" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const adminUserId = await requireAdmin(req);
    const { isEnabled, message } = await req.json();

    const [existing] = await db
      .select()
      .from(maintenanceFlags)
      .where(eq(maintenanceFlags.flagKey, MAINTENANCE_MODE_KEY))
      .limit(1);

    if (existing) {
      await db
        .update(maintenanceFlags)
        .set({
          flagValue: isEnabled ? 1 : 0,
          description: message || "System is under maintenance. Please check back later.",
          lastModifiedBy: adminUserId,
          lastModifiedAt: new Date(),
        })
        .where(eq(maintenanceFlags.flagKey, MAINTENANCE_MODE_KEY));
    } else {
      await db.insert(maintenanceFlags).values({
        flagKey: MAINTENANCE_MODE_KEY,
        flagValue: isEnabled ? 1 : 0,
        description: message || "System is under maintenance. Please check back later.",
        lastModifiedBy: adminUserId,
      });
    }

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    await db.insert(adminActionLogs).values({
      userId: adminUserId,
      action: 'maintenance_mode_toggled',
      targetType: 'system',
      targetId: 'maintenance_mode',
      details: JSON.stringify({
        isEnabled,
        message,
        ipAddress: clientIp,
      }),
    });

    return NextResponse.json({
      success: true,
      isEnabled,
      message,
    });
  } catch (error) {
    console.error("Update maintenance flag error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update maintenance flag" },
      { status: 500 }
    );
  }
}
