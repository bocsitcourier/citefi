import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publishingJobs } from '@/shared/schema';
import { eq, and } from 'drizzle-orm';
import { addPublishingJob } from '@/lib/queue';
import { requireTeamMember } from '@/lib/api/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await params;
    const jobId = parseInt(id, 10);

    if (isNaN(jobId)) {
      return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });
    }

    const [job] = await db
      .select()
      .from(publishingJobs)
      .where(and(eq(publishingJobs.id, jobId), eq(publishingJobs.teamId, teamId)))
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status === 'sent') {
      return NextResponse.json({ error: 'Job already sent — no retry needed' }, { status: 400 });
    }

    // Reset the job for re-queuing
    await db
      .update(publishingJobs)
      .set({
        status: 'pending',
        attempts: 0,
        lastError: null,
        errorDetails: null,
        nextRetryAt: null,
        updatedAt: new Date(),
      })
      .where(eq(publishingJobs.id, jobId));

    // Re-enqueue in pg-boss
    const pgBossJobId = await addPublishingJob({ dbJobId: job.id, teamId: job.teamId });

    if (pgBossJobId) {
      await db
        .update(publishingJobs)
        .set({ pgBossJobId, updatedAt: new Date() })
        .where(eq(publishingJobs.id, jobId));
    }

    console.log(`🔁 Publishing job ${jobId} manually retried — new BullMQ job: ${pgBossJobId}`);

    return NextResponse.json({ success: true, message: 'Job queued for retry' });
  } catch (error: any) {
    console.error('Error retrying publishing job:', error);
    if (error?.statusCode === 401) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to retry job' }, { status: error?.statusCode || 500 });
  }
}
