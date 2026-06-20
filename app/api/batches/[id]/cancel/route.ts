import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobBatches, articles } from "@/shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { neonHttpDb } from "@/lib/db";
import { sql } from "drizzle-orm";

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

    // Cancel all pending pg-boss article-generation jobs for this batch.
    // Jobs in 'created' state (not yet picked up) can be cancelled directly.
    // Jobs in 'active' state will be intercepted by the CANCELLED check in the worker.
    const cancelResult = await neonHttpDb.execute(sql`
      UPDATE pgboss.job
      SET state = 'cancelled', completed_on = NOW()
      WHERE name = 'article-generation'
        AND state = 'created'
        AND data->>'batchId' = ${batchId.toString()}
    `);

    const cancelledJobs = (cancelResult as any).rowCount || 0;

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

    console.log(`🛑 Batch ${batchId} cancelled by team ${teamId}: ${cancelledJobs} pg-boss jobs cancelled`);

    return NextResponse.json({
      success: true,
      message: `Batch cancelled. ${cancelledJobs} queued job(s) stopped.`,
    });
  } catch (error: any) {
    console.error("Error cancelling batch:", error);
    return NextResponse.json({ error: "Failed to cancel batch" }, { status: error?.statusCode || 500 });
  }
}
