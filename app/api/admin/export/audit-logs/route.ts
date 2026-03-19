import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminActionLogs, users, loginHistory } from "@/shared/schema";
import { eq, desc, gte, lte, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";
import { format } from "date-fns";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const exportFormat = searchParams.get("format") || "csv";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const logType = searchParams.get("type") || "admin_actions"; // 'admin_actions' or 'login_history'

    let conditions = [];

    if (startDate) {
      conditions.push(
        logType === "admin_actions"
          ? gte(adminActionLogs.createdAt, new Date(startDate))
          : gte(loginHistory.createdAt, new Date(startDate))
      );
    }

    if (endDate) {
      conditions.push(
        logType === "admin_actions"
          ? lte(adminActionLogs.createdAt, new Date(endDate))
          : lte(loginHistory.createdAt, new Date(endDate))
      );
    }

    let data: any[] = [];

    if (logType === "admin_actions") {
      data = await db
        .select({
          id: adminActionLogs.id,
          adminUserId: adminActionLogs.userId,
          adminEmail: users.email,
          adminName: users.fullName,
          action: adminActionLogs.action,
          targetType: adminActionLogs.targetType,
          targetId: adminActionLogs.targetId,
          details: adminActionLogs.details,
          createdAt: adminActionLogs.createdAt,
        })
        .from(adminActionLogs)
        .leftJoin(users, eq(adminActionLogs.userId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(adminActionLogs.createdAt));
    } else {
      data = await db
        .select({
          id: loginHistory.id,
          userId: loginHistory.userId,
          userEmail: users.email,
          userName: users.fullName,
          ipAddress: loginHistory.ipAddress,
          userAgent: loginHistory.userAgent,
          success: loginHistory.success,
          failureReason: loginHistory.failureReason,
          createdAt: loginHistory.createdAt,
        })
        .from(loginHistory)
        .leftJoin(users, eq(loginHistory.userId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(loginHistory.createdAt));
    }

    if (exportFormat === "json") {
      return NextResponse.json(data);
    }

    // Generate CSV
    let csv = "";
    
    if (logType === "admin_actions") {
      csv = "ID,Admin Email,Admin Name,Action,Target User Email,IP Address,Timestamp,Metadata\n";
      data.forEach((row) => {
        csv += `${row.id},"${row.adminEmail || ''}","${row.adminName || ''}","${row.action}","${row.targetUserEmail || ''}","${row.ipAddress}","${format(new Date(row.createdAt), "yyyy-MM-dd HH:mm:ss")}","${row.metadata ? JSON.stringify(row.metadata).replace(/"/g, '""') : ''}"\n`;
      });
    } else {
      csv = "ID,User Email,User Name,IP Address,User Agent,Success,Failure Reason,Login Time\n";
      data.forEach((row) => {
        csv += `${row.id},"${row.userEmail || ''}","${row.userName || ''}","${row.ipAddress}","${row.userAgent || ''}","${row.success}","${row.failureReason || ''}","${format(new Date(row.loginAt), "yyyy-MM-dd HH:mm:ss")}"\n`;
      });
    }

    const filename = `${logType}_export_${format(new Date(), "yyyy-MM-dd_HHmmss")}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error("Export audit logs error:", error);
    
    const message = error instanceof Error ? error.message : "Failed to export audit logs";
    let status = 500;
    
    if (message === "Authentication required" || message === "No authentication token provided" || message === "Invalid or expired token") {
      status = 401;
    } else if (message === "Admin access required") {
      status = 403;
    } else if (error.statusCode) {
      status = error.statusCode;
    }
    
    return NextResponse.json({ error: message }, { status });
  }
}
