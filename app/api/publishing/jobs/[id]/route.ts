import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publishingJobs, articles } from '@/shared/schema';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { withAuthenticatedTeamContext, withAuthenticatedClientReviewerContext } from '@/lib/api/auth';
import { canRetryPublication, dispatchContract } from '@/lib/publishing/dispatch-policy';
import { reconciliationOf } from '@/lib/publishing/reconciliation';
import { clientPublishingSummary } from '@/lib/publishing/client-summary';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withAuthenticatedClientReviewerContext(request, async (auth) => {
      const { teamId } = auth;
    const { id } = await params;
    const jobId = parseInt(id);

    if (isNaN(jobId)) {
      return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });
    }
    if (auth.role === 'client_viewer') {
      const [summary] = await clientPublishingSummary(jobId, null, null, 1);
      if (!summary) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      return NextResponse.json({ success: true, data: summary });
    }

    const [job] = await db
      .select()
      .from(publishingJobs)
      .where(and(eq(publishingJobs.id, jobId), eq(publishingJobs.teamId, teamId)));

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const { errorDetails, ...visible } = job;
    return NextResponse.json({ success: true, data: {
      ...visible, ...(auth.role === 'client_viewer' ? { lastError: null, pgBossJobId: undefined } : {}),
      retryable: auth.role !== 'client_viewer' && canRetryPublication(job),
      reconciliationStatus: (errorDetails as Record<string, unknown> | null)?.reconciliationConflict === true
        ? 'conflicting_evidence' : reconciliationOf(job).decision?.outcome ?? (job.status === 'outcome_unknown' ? 'unresolved' : null),
      replacementJobId: reconciliationOf(job).replacementJobId ?? null,
    } });
      });
  } catch (error: any) {
    console.error('Error fetching publishing job:', error);
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: error?.statusCode || 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withAuthenticatedTeamContext(request, async (auth) => {
      const { teamId } = auth;
    const { id } = await params;
    const jobId = parseInt(id);

    if (isNaN(jobId)) {
      return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });
    }

    const [job] = await db
      .select()
      .from(publishingJobs)
      .where(and(eq(publishingJobs.id, jobId), eq(publishingJobs.teamId, teamId)));

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (!['pending', 'failed'].includes(job.status) || job.lastAttemptAt || job.attempts > 0 ||
        dispatchContract(job.errorDetails)?.submissionStarted || reconciliationOf(job).decision ||
        (job.errorDetails as Record<string, unknown> | null)?.replacementOf) {
      return NextResponse.json(
        { error: 'Dispatched jobs must be retained for delivery reconciliation and audit' },
        { status: 409 }
      );
    }

    const removed = await db
      .delete(publishingJobs)
      .where(and(
        eq(publishingJobs.id, jobId), eq(publishingJobs.teamId, teamId),
        inArray(publishingJobs.status, ['pending', 'failed']),
        isNull(publishingJobs.lastAttemptAt),
        eq(publishingJobs.attempts, 0),
        sql`coalesce(${publishingJobs.errorDetails}->'dispatchContract'->>'submissionStarted', 'false') = 'false'`,
        sql`${publishingJobs.errorDetails}->'reconciliation' IS NULL`,
        sql`${publishingJobs.errorDetails}->'replacementOf' IS NULL`,
      )).returning({ id: publishingJobs.id });
    if (!removed.length) return NextResponse.json({ error: 'Job was dispatched concurrently and cannot be deleted' }, { status: 409 });

    return NextResponse.json({ success: true, message: 'Job deleted' });
      });
  } catch (error: any) {
    console.error('Error deleting publishing job:', error);
    return NextResponse.json({ error: 'Failed to delete job' }, { status: error?.statusCode || 500 });
  }
}
