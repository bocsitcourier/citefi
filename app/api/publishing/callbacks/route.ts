import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { publishingJobs, publishingConnections, publishingCallbacks } from '@/shared/schema';
import { eq } from 'drizzle-orm';
import { getApiKeyForConnection } from '@/lib/publishing';

const callbackSchema = z.object({
  jobId: z.string(),
  status: z.enum(['success', 'failure', 'partial', 'retryable']),
  pageUrl: z.string().optional(),
  slug: z.string().optional(),
  mediaUrls: z.record(z.string()).optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  timestamp: z.string(),
});

function verifyHmacSignature(
  payload: string,
  signature: string,
  apiKey: string,
  timestamp: string
): boolean {
  const message = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', apiKey)
    .update(message)
    .digest('hex');
  
  if (signature.length !== expectedSignature.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-citefi-signature');
    const timestamp = request.headers.get('x-citefi-timestamp');
    
    if (!signature || !timestamp) {
      return NextResponse.json(
        { error: 'Missing authentication headers' },
        { status: 401 }
      );
    }

    const requestTime = parseInt(timestamp, 10);
    const currentTime = Date.now();
    if (isNaN(requestTime) || Math.abs(currentTime - requestTime) > 300000) {
      return NextResponse.json(
        { error: 'Request timestamp expired (replay protection)' },
        { status: 401 }
      );
    }
    
    const bodyText = await request.text();
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }
    
    const parsed = callbackSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid callback payload', details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { jobId, status, pageUrl, slug, mediaUrls, error, errorCode } = parsed.data;

    const [job] = await db.select().from(publishingJobs)
      .where(eq(publishingJobs.publicId, jobId as any))
      .limit(1);
    
    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    const [connection] = await db.select().from(publishingConnections)
      .where(eq(publishingConnections.id, job.connectionId))
      .limit(1);
    
    if (!connection) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      );
    }

    if (connection.teamId !== job.teamId) {
      console.warn(`Team mismatch attempt: connection ${connection.id} teamId ${connection.teamId} vs job ${job.id} teamId ${job.teamId}`);
      return NextResponse.json(
        { error: 'Team mismatch - unauthorized' },
        { status: 403 }
      );
    }

    let apiKey: string | undefined;
    try {
      apiKey = await getApiKeyForConnection(connection.id);
    } catch (e) {
      console.error(`Failed to decrypt API key for connection ${connection.id}:`, e);
      return NextResponse.json(
        { error: 'Authentication configuration error - please regenerate API key' },
        { status: 401 }
      );
    }
    
    if (!apiKey) {
      console.error(`No API key available for connection ${connection.id} - no encrypted key stored`);
      return NextResponse.json(
        { error: 'Authentication failed - API key not found' },
        { status: 401 }
      );
    }
    
    const isValidSignature = verifyHmacSignature(bodyText, signature, apiKey, timestamp);
    if (!isValidSignature) {
      console.warn(`Invalid HMAC signature for callback from connection ${connection.id}`);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    await db.insert(publishingCallbacks).values({
      publishingJobId: job.id,
      status: status,
      payload: parsed.data as any,
      signature: signature,
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    });
    
    if (status === 'success') {
      await db.update(publishingJobs)
        .set({
          status: 'delivered',
          publishedUrl: pageUrl,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishingJobs.id, job.id));
    } else if (status === 'failure') {
      const newAttempts = job.attempts + 1;
      const shouldRetry = newAttempts < job.maxAttempts;
      
      await db.update(publishingJobs)
        .set({
          status: shouldRetry ? 'pending' : 'failed',
          attempts: newAttempts,
          lastError: error,
          errorDetails: parsed.data as any,
          lastAttemptAt: new Date(),
          nextRetryAt: shouldRetry ? new Date(Date.now() + 60000 * newAttempts) : null,
          updatedAt: new Date(),
        })
        .where(eq(publishingJobs.id, job.id));
    }

    return NextResponse.json({
      success: true,
      message: 'Callback processed',
    });
  } catch (error) {
    console.error('Error processing callback:', error);
    return NextResponse.json(
      { error: 'Failed to process callback' },
      { status: 500 }
    );
  }
}
