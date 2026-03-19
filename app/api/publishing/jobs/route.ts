import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { publishingJobs, articles, publishingConnections } from '@/shared/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { createPublishingJob, getConnectionById } from '@/lib/publishing';
import { requireTeamMember } from '@/lib/api/auth';

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
    const { teamId } = await requireTeamMember(request);

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status');
    const contentTypeFilter = searchParams.get('contentType');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

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

    return NextResponse.json({ success: true, data: jobs });
  } catch (error) {
    console.error('Error fetching publishing jobs:', error);
    return NextResponse.json({ error: 'Failed to fetch publishing jobs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

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

    const job = await createPublishingJob(teamId, connectionId, contentType, contentId);

    return NextResponse.json({ success: true, data: job, message: 'Publishing job created' });
  } catch (error) {
    console.error('Error creating publishing job:', error);
    return NextResponse.json({ error: 'Failed to create publishing job' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

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
      .select({ id: publishingJobs.id, status: publishingJobs.status })
      .from(publishingJobs)
      .where(and(eq(publishingJobs.teamId, teamId), inArray(publishingJobs.id, ids)));

    const deletableIds = jobsToDelete
      .filter((j) => j.status !== 'processing')
      .map((j) => j.id);

    if (deletableIds.length === 0) {
      return NextResponse.json(
        { error: 'No deletable jobs found (active processing jobs cannot be deleted)' },
        { status: 400 }
      );
    }

    await db
      .delete(publishingJobs)
      .where(and(eq(publishingJobs.teamId, teamId), inArray(publishingJobs.id, deletableIds)));

    return NextResponse.json({
      success: true,
      deleted: deletableIds.length,
      skipped: ids.length - deletableIds.length,
    });
  } catch (error) {
    console.error('Error batch deleting publishing jobs:', error);
    return NextResponse.json({ error: 'Failed to delete jobs' }, { status: 500 });
  }
}
