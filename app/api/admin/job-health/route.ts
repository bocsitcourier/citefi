import { NextRequest, NextResponse } from "next/server";
import { getQueue, ALL_QUEUE_NAMES } from "@/lib/queue";
import { requireAdmin } from "@/lib/api/auth";

const STUCK_JOB_QUEUES = [
  "article-generation",
  "social-video-generation",
  "video-idea-generation",
  "article-podcast",
  "intelligence-research",
];

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const queueHealth = await Promise.all(
      ALL_QUEUE_NAMES.map(async (name) => {
        try {
          const queue = getQueue(name);
          const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
          return {
            name,
            pending: (counts.waiting ?? 0) + (counts.delayed ?? 0),
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
          };
        } catch {
          return { name, pending: 0, active: 0, completed: 0, failed: 0, error: "unavailable" };
        }
      })
    );

    const stuckJobs: { id: string | undefined; name: string; state: string; minutesActive: number }[] = [];
    for (const name of STUCK_JOB_QUEUES) {
      try {
        const queue = getQueue(name);
        const activeJobs = await queue.getActive(0, 50);
        for (const job of activeJobs) {
          const minutesActive = job.processedOn
            ? (Date.now() - job.processedOn) / 60000
            : 0;
          if (minutesActive > 20) {
            stuckJobs.push({
              id: job.id,
              name,
              state: "active",
              minutesActive: Math.round(minutesActive),
            });
          }
        }
      } catch {
        // Queue unavailable — skip
      }
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      queues: queueHealth,
      stuckJobs,
      totalStuck: stuckJobs.length,
      autoExpireEnabled: true,
      autoExpireTimeout: "20 minutes",
    });

  } catch (error: any) {
    console.error("Job health check error:", error);
    return NextResponse.json(
      { error: "Failed to check job health" },
      { status: error?.statusCode || 500 }
    );
  }
}
