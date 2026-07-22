import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobBatches, articles } from "@/shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { getQueue, ARTICLE_GENERATION_QUEUE } from "@/lib/queue";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    const batchId = parseInt(id);

    if (isNaN(batchId)) {
      return NextResponse.json({ error: "Invalid batch ID" }, { status: 400 });
    }

    const [batch] = await db
      .select({ id: jobBatches.id, status: jobBatches.status, teamId: jobBatches.teamId })
      .from(jobBatches)
      .where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)));

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    if (!["RUNNING", "PENDING"].includes(batch.status)) {
      return NextResponse.json(
        { error: `Batch is already in ${batch.status} state and cannot be cancelled` },
        { status: 400 }
      );
    }

    await db
      .update(jobBatches)
      .set({ status: "CANCELLED" })
      .where(eq(jobBatches.id, batchId));

    // Cancel all waiting/delayed BullMQ article-generation jobs for this batch.
    // Active jobs will be intercepted by the CANCELLED check in the worker.
    let cancelledJobs = 0;
    try {
      const queue = getQueue(ARTICLE_GENERATION_QUEUE);
      const [waitingJobs, delayedJobs] = await Promise.all([
        queue.getWaiting(0, 1000),
        queue.getDelayed(0, 1000),
      ]);
      const batchJobs = [...waitingJobs, ...delayedJobs].filter(
        (job) => job.data.batchId === batchId
      );
      await Promise.all(batchJobs.map((job) => job.remove().catch(() => {})));
      cancelledJobs = batchJobs.length;
    } catch (queueErr) {
      console.warn(`⚠️ Could not remove BullMQ jobs for batch ${batchId}:`, queueErr);
    }

    // Mark PENDING articles as FAILED so the UI reflects the cancellation clearly.
    await db
      .update(articles)
      .set({
        articleStatus: "FAILED",
        errorMessage: "Cancelled by user",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(articles.batchId, batchId),
          inArray(articles.articleStatus, ["PENDING"])
        )
      );

    console.log(`🛑 Batch ${batchId} cancelled by team ${teamId}: ${cancelledJobs} BullMQ jobs removed`);

    return NextResponse.json({
      success: true,
      message: `Batch cancelled. ${cancelledJobs} queued job(s) stopped.`,
    });
  } catch (error: any) {
    console.error("Error cancelling batch:", error);
    return NextResponse.json({ error: "Failed to cancel batch" }, { status: error?.statusCode || 500 });
  }
}
