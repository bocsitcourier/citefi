import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import os from "os";

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

    const pgBossStatsResult = await db.execute(sql`
      SELECT 
        (SELECT count(*) FROM pgboss.job WHERE state = 'active') as active_jobs,
        (SELECT count(*) FROM pgboss.job WHERE state = 'completed') as completed_jobs,
        (SELECT count(*) FROM pgboss.job WHERE state = 'failed') as failed_jobs,
        (SELECT count(*) FROM pgboss.job WHERE state = 'retry') as retry_jobs
    `);
    const pgBossStats = (pgBossStatsResult as any).rows?.[0] ?? { active_jobs: 0, completed_jobs: 0, failed_jobs: 0, retry_jobs: 0 };

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
      uptime: uptime,
      database: {
        size: Number(dbStats.db_size) || 0,
        activeConnections: Number(dbStats.active_connections) || 0,
      },
      queue: {
        activeJobs: Number(pgBossStats.active_jobs) || 0,
        completedJobs: Number(pgBossStats.completed_jobs) || 0,
        failedJobs: Number(pgBossStats.failed_jobs) || 0,
        retryJobs: Number(pgBossStats.retry_jobs) || 0,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("System health error:", error);
    
    const message = error instanceof Error ? error.message : "Failed to fetch system health";
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
