import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publishingJobs, articles } from '@/shared/schema';
import { eq, and } from 'drizzle-orm';
import { requireTeamMember } from '@/lib/api/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
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

    return NextResponse.json({ success: true, data: job });
  } catch (error) {
    console.error('Error fetching publishing job:', error);
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
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

    if (job.status === 'processing') {
      return NextResponse.json(
        { error: 'Cannot delete a job that is currently processing' },
        { status: 400 }
      );
    }

    await db
      .delete(publishingJobs)
      .where(and(eq(publishingJobs.id, jobId), eq(publishingJobs.teamId, teamId)));

    return NextResponse.json({ success: true, message: 'Job deleted' });
  } catch (error) {
    console.error('Error deleting publishing job:', error);
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
  }
}
