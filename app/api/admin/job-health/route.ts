import { NextRequest, NextResponse } from "next/server";
import { getPgBoss } from "@/lib/queue";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

/**
 * Job Health Check API
 * GET /api/admin/job-health
 * 
 * Returns current job queue stats and stuck job detection
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const boss = await getPgBoss();
    
    // Get all queue states
    const queues = await boss.getQueues();
    
    const queueHealth = [];
    
    for (const queue of queues) {
      const queueName = typeof queue === 'string' ? queue : queue.name;
      
      // Get job counts by state from pgboss.job table directly
      const queueStats = await db.execute(sql`
        SELECT 
          COUNT(*) FILTER (WHERE state = 'created') as created,
          COUNT(*) FILTER (WHERE state = 'active') as active,
          COUNT(*) FILTER (WHERE state = 'completed') as completed,
          COUNT(*) FILTER (WHERE state = 'failed') as failed
        FROM pgboss.job
        WHERE name = ${queueName}
      `);
      
      const stats = queueStats.rows[0] as any;
      const created = Number(stats.created || 0);
      const active = Number(stats.active || 0);
      const completed = Number(stats.completed || 0);
      const failed = Number(stats.failed || 0);
      
      queueHealth.push({
        name: queueName,
        pending: created || 0,
        active: active || 0,
        completed: completed || 0,
        failed: failed || 0,
      });
    }
    
    // Get stuck jobs (active > 20 minutes)
    const stuckJobsResult = await db.execute(sql`
      SELECT id, name, state, started_on, 
             EXTRACT(EPOCH FROM (NOW() - started_on)) / 60 as minutes_active
      FROM pgboss.job
      WHERE state = 'active'
        AND started_on < NOW() - INTERVAL '20 minutes'
      ORDER BY started_on ASC
      LIMIT 10
    `);
    
    const stuckJobs = stuckJobsResult.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      state: row.state,
      startedOn: row.started_on,
      minutesActive: Math.round(row.minutes_active),
    }));
    
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      queues: queueHealth,
      stuckJobs,
      totalStuck: stuckJobs.length,
      autoExpireEnabled: true,
      autoExpireTimeout: "20 minutes",
    });
    
  } catch (error) {
    console.error("Job health check error:", error);
    return NextResponse.json(
      { error: "Failed to check job health" },
      { status: 500 }
    );
  }
}
