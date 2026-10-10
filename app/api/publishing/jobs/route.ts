import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { publishingJobs, articles, publishingConnections, videoIdeas, socialPosts } from '@/shared/schema';
import { eq, and, desc, inArray, isNull, sql } from 'drizzle-orm';
import { createPublishingJob, getConnectionById } from '@/lib/publishing';
import { canRetryPublication } from '@/lib/publishing/dispatch-policy';
import { withAuthenticatedTeamContext, withAuthenticatedClientReviewerContext } from '@/lib/api/auth';
import { dispatchContract } from '@/lib/publishing/dispatch-policy';
import { reconciliationOf } from '@/lib/publishing/reconciliation';
import { clientPublishingSummary } from '@/lib/publishing/client-summary';

const createJobSchema = z.object({
  connectionId: z.number(),
  contentType: z.enum(['article', 'social_post', 'video', 'podcast']),
  contentId: z.number(),
});

const batchDeleteSchema = z.object({
  ids: z.array(z.number()).min(1),
});

export async function GET(request: NextRequest) {
  try {
    return await withAuthenticatedClientReviewerContext(request, async (auth) => {
      const { teamId } = auth;

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status');
    const contentTypeFilter = searchParams.get('contentType');
    const requestedLimit = Number(searchParams.get('limit') || '100');
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(200, requestedLimit)) : 100;
    if (auth.role === 'client_viewer') {
      return NextResponse.json({ success: true, data: await clientPublishingSummary(null, statusFilter, contentTypeFilter, limit) });
    }

    // Build conditions
    const conditions = [eq(publishingJobs.teamId, teamId)];
    if (statusFilter) conditions.push(eq(publishingJobs.status, statusFilter));
    if (contentTypeFilter) conditions.push(eq(publishingJobs.contentType, contentTypeFilter));

    const jobs = await db
      .select({
        id: publishingJobs.id,
        publicId: publishingJobs.publicId,
        connectionId: publishingJobs.connectionId,
        teamId: publishingJobs.teamId,
        contentType: publishingJobs.contentType,
        articleId: publishingJobs.articleId,
        videoIdeaId: publishingJobs.videoIdeaId,
        status: publishingJobs.status,
        attempts: publishingJobs.attempts,
        maxAttempts: publishingJobs.maxAttempts,
        lastError: publishingJobs.lastError,
        publishedUrl: publishingJobs.publishedUrl,
        publishedAt: publishingJobs.publishedAt,
        createdAt: publishingJobs.createdAt,
        updatedAt: publishingJobs.updatedAt,
        lastAttemptAt: publishingJobs.lastAttemptAt,
        errorDetails: publishingJobs.errorDetails,
        nextRetryAt: publishingJobs.nextRetryAt,
        articleTitle: articles.chosenTitle,
        connectionName: publishingConnections.name,
        connectionBaseUrl: publishingConnections.baseUrl,
      })
      .from(publishingJobs)
      .leftJoin(articles, eq(publishingJobs.articleId, articles.id))
      .leftJoin(publishingConnections, eq(publishingJobs.connectionId, publishingConnections.id))
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(desc(publishingJobs.createdAt))
      .limit(limit);

    const operator = ["owner", "admin", "platform_admin"].includes(auth.role);
    return NextResponse.json({ success: true, data: jobs.map(({ errorDetails, ...job }) => {
      const retained = reconciliationOf({ errorDetails });
      const client = auth.role === "client_viewer";
      return {
        ...job, ...(client ? { lastError: null, connectionBaseUrl: null } : {}),
        retryable: !client && canRetryPublication({ ...job, errorDetails }),
        deletable: !client && ['pending', 'failed'].includes(job.status) && job.lastAttemptAt === null && job.attempts === 0 &&
          !dispatchContract(errorDetails)?.submissionStarted && !retained.decision &&
          !(errorDetails as Record<string, unknown> | null)?.replacementOf,
        canReconcile: operator && (["outcome_unknown", "sent", "processing", "not_accepted"].includes(job.status) || !!retained.decision || !!retained.audit?.length ||
          (job.status === "failed" && !canRetryPublication({ ...job, errorDetails }))),
        reconciliationStatus: (errorDetails as Record<string, unknown> | null)?.reconciliationConflict === true
          ? "conflicting_evidence" : retained.decision?.outcome ?? (job.status === "outcome_unknown" ? "unresolved" : null),
        replacementJobId: retained.replacementJobId ?? null,
      };
    }) });
      });
  } catch (error: any) {
    console.error('Error fetching publishing jobs:', error);
    const status = (error as any)?.statusCode ?? 500;
    return NextResponse.json({ error: 'Failed to fetch publishing jobs' }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    return await withAuthenticatedTeamContext(request, async (auth) => {
      const { teamId } = auth;

    const body = await request.json();
    const parsed = createJobSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { connectionId, contentType, contentId } = parsed.data;

    const connection = await getConnectionById(connectionId, teamId);
    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    if (connection.status === 'error') {
      return NextResponse.json(
        { error: 'Connection has errors. Check connection settings.' },
        { status: 400 }
      );
    }

    // IDOR guard: verify the content belongs to this team before publishing.
    // Return 404 (not 403) so content IDs from other teams cannot be probed.
    let contentOwned = false;
    if (contentType === 'article' || contentType === 'podcast') {
      const [row] = await db
        .select({ id: articles.id })
        .from(articles)
        .where(and(eq(articles.id, contentId), eq(articles.teamId, teamId)))
        .limit(1);
      contentOwned = !!row;
    } else if (contentType === 'video') {
      const [row] = await db
        .select({ id: videoIdeas.id })
        .from(videoIdeas)
        .where(and(eq(videoIdeas.id, contentId), eq(videoIdeas.teamId, teamId)))
        .limit(1);
      contentOwned = !!row;
    } else if (contentType === 'social_post') {
      const [row] = await db
        .select({ id: socialPosts.id })
        .from(socialPosts)
        .where(and(eq(socialPosts.id, contentId), eq(socialPosts.teamId, teamId)))
        .limit(1);
      contentOwned = !!row;
    }

    if (!contentOwned) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    const job = await createPublishingJob(teamId, connectionId, contentType, contentId,
      { userId: auth.userId, role: auth.role });

    const { errorDetails: _privateDetails, ...visibleJob } = job;
    return NextResponse.json({ success: true, data: visibleJob, message: 'Publishing operation recorded; identical requests reuse the same job' });
      });
  } catch (error: any) {
    console.error('Error creating publishing job:', error);
    const status = (error as any)?.statusCode ?? 500;
    return NextResponse.json({ error: status < 500 ? error.message : 'Failed to create publishing job' }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    return await withAuthenticatedTeamContext(request, async (auth) => {
      const { teamId } = auth;

    const body = await request.json();
    const parsed = batchDeleteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { ids } = parsed.data;

    // Only delete jobs that belong to this team and are not currently processing
    const jobsToDelete = await db
      .select({ id: publishingJobs.id, status: publishingJobs.status, lastAttemptAt: publishingJobs.lastAttemptAt,
        attempts: publishingJobs.attempts, errorDetails: publishingJobs.errorDetails })
      .from(publishingJobs)
      .where(and(eq(publishingJobs.teamId, teamId), inArray(publishingJobs.id, ids)));

    const deletableIds = jobsToDelete
      .filter((j) => ['pending', 'failed', 'cancelled'].includes(j.status) && !j.lastAttemptAt &&
        j.attempts === 0 && !dispatchContract(j.errorDetails)?.submissionStarted && !reconciliationOf(j).decision &&
        !(j.errorDetails as Record<string, unknown> | null)?.replacementOf)
      .map((j) => j.id);

    if (deletableIds.length === 0) {
      return NextResponse.json(
        { error: 'No deletable jobs found (active processing jobs cannot be deleted)' },
        { status: 400 }
      );
    }

    const deleted = await db
      .delete(publishingJobs)
      .where(and(eq(publishingJobs.teamId, teamId), inArray(publishingJobs.id, deletableIds),
        inArray(publishingJobs.status, ['pending', 'failed', 'cancelled']),
        isNull(publishingJobs.lastAttemptAt), eq(publishingJobs.attempts, 0),
        sql`coalesce(${publishingJobs.errorDetails}->'dispatchContract'->>'submissionStarted', 'false') = 'false'`,
        sql`${publishingJobs.errorDetails}->'reconciliation' IS NULL`,
        sql`${publishingJobs.errorDetails}->'replacementOf' IS NULL`))
      .returning({ id: publishingJobs.id });

    return NextResponse.json({
      success: true,
      deleted: deleted.length,
      skipped: ids.length - deleted.length,
    });
      });
  } catch (error: any) {
    console.error('Error batch deleting publishing jobs:', error);
    return NextResponse.json({ error: 'Failed to delete jobs' }, { status: error?.statusCode || 500 });
  }
}
