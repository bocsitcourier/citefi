import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import os from "os";
import { getQueue, ALL_QUEUE_NAMES } from "@/lib/queue";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsage = (usedMem / totalMem) * 100;

    const cpuUsage = os.loadavg()[0];
    const uptime = process.uptime();

    const dbStatsResult = await db.execute(sql`
      SELECT 
        pg_database_size(current_database()) as db_size,
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections
    `);
    const dbStats = (dbStatsResult as any).rows?.[0] ?? { db_size: 0, active_connections: 0 };

    // Aggregate BullMQ counts across all registered queues
    let totalActive = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    let totalWaiting = 0;
    try {
      await Promise.all(
        ALL_QUEUE_NAMES.map(async (name) => {
          try {
            const counts = await getQueue(name).getJobCounts("active", "completed", "failed", "waiting", "delayed");
            totalActive += counts.active ?? 0;
            totalCompleted += counts.completed ?? 0;
            totalFailed += counts.failed ?? 0;
            totalWaiting += (counts.waiting ?? 0) + (counts.delayed ?? 0);
          } catch {
            // Queue temporarily unavailable — skip
          }
        })
      );
    } catch {
      // Non-fatal — queue stats are best-effort
    }

    return NextResponse.json({
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        percentage: memoryUsage,
      },
      cpu: {
        loadAverage: cpuUsage,
        cores: os.cpus().length,
      },
      uptime,
      database: {
        size: Number(dbStats.db_size) || 0,
        activeConnections: Number(dbStats.active_connections) || 0,
      },
      queue: {
        activeJobs: totalActive,
        completedJobs: totalCompleted,
        failedJobs: totalFailed,
        waitingJobs: totalWaiting,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("System health error:", error);

    const message = error instanceof Error ? error.message : "Failed to fetch system health";
    let status = 500;

    if (
      message === "Authentication required" ||
      message === "No authentication token provided" ||
      message === "Invalid or expired token"
    ) {
      status = 401;
    } else if (message === "Admin access required") {
      status = 403;
    } else if (error.statusCode) {
      status = error.statusCode;
    }

    return NextResponse.json({ error: message }, { status });
  }
}
