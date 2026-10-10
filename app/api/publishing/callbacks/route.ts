import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { systemDb as db } from '@/lib/db';
import { publishingJobs, publishingConnections, publishingCallbacks } from '@/shared/schema';
import { and, eq } from 'drizzle-orm';
import { getApiKeyForConnection, hashApiKey } from '@/lib/publishing';
import { runWithSystemContext } from '@/lib/tenant-context';
import { callbackStateUpdate } from '@/lib/publishing/callback-state';
import { callbackMatchesAttempt, dispatchContract } from '@/lib/publishing/dispatch-policy';

const callbackSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(['success', 'failure', 'partial', 'retryable']),
  pageUrl: z.string().max(2048).url().refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Published URLs must use HTTPS without embedded credentials').optional(),
  slug: z.string().optional(),
  mediaUrls: z.record(z.string()).optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  timestamp: z.string(),
  dispatchAttempt: z.string().datetime().optional(),
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
  
  if (!/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }
  
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

export async function POST(request: NextRequest) {
  return runWithSystemContext("signed publishing provider callback", () => receiveCallback(request));
}

async function receiveCallback(request: NextRequest) {
  try {
    const signature = request.headers.get('x-citefi-signature');
    const timestamp = request.headers.get('x-citefi-timestamp');
    
    if (!signature || !timestamp) {
      return NextResponse.json(
        { error: 'Missing authentication headers' },
        { status: 401 }
      );
    }

    const requestTime = /^\d+$/.test(timestamp) ? Number(timestamp) : NaN;
    const currentTime = Date.now();
    if (isNaN(requestTime) || Math.abs(currentTime - requestTime) > 300000) {
      return NextResponse.json(
        { error: 'Request timestamp expired (replay protection)' },
        { status: 401 }
      );
    }
    
    // Check actual streamed bytes, not only the untrusted Content-Length.
    const maximumBytes = 1024 * 1024;
    if (Number(request.headers.get('content-length')) > maximumBytes) {
      return NextResponse.json({ error: 'Callback body too large' }, { status: 413 });
    }
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maximumBytes) {
          await reader.cancel();
          return NextResponse.json({ error: 'Callback body too large' }, { status: 413 });
        }
        chunks.push(chunk.value);
      }
    }
    const bodyText = Buffer.concat(chunks, bytes).toString('utf8');
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
    const originalReceiver = dispatchContract(job.errorDetails);
    if (originalReceiver?.receiverOrigin && originalReceiver.receiverKeyHash &&
        (new URL(connection.baseUrl!).origin !== originalReceiver.receiverOrigin ||
         hashApiKey(apiKey) !== originalReceiver.receiverKeyHash ||
         (status === 'success' && pageUrl && new URL(pageUrl).origin !== originalReceiver.receiverOrigin))) {
      return NextResponse.json({ error: 'Receipt does not match the original receiver identity' }, { status: 409 });
    }
    
    const isValidSignature = verifyHmacSignature(bodyText, signature, apiKey, timestamp);
    if (!isValidSignature) {
      console.warn(`Invalid HMAC signature for callback from connection ${connection.id}`);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    const outcome = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(publishingJobs)
        .where(eq(publishingJobs.id, job.id)).for('update');
      if (!current) throw new Error('Publishing job no longer exists');
      // Serialize receipt lookup + insertion + transition using the durable job lock.
      // JSONB equality deduplicates the same event even when it is re-signed.
      const [receipt] = await tx.select({ id: publishingCallbacks.id }).from(publishingCallbacks)
        .where(and(eq(publishingCallbacks.publishingJobId, job.id), eq(publishingCallbacks.payload, parsed.data)))
        .limit(1);
      if (receipt) return 'duplicate';
      await tx.insert(publishingCallbacks).values({
      publishingJobId: job.id,
      status: status,
      payload: parsed.data as any,
      signature: signature,
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    });
    // A contradictory late success is retained, not used to reset an
    // adjudicated operation. Fence any not-yet-submitted replacement as well.
    if (current.status === 'not_accepted' && status === 'success' &&
        parsed.data.dispatchAttempt === current.lastAttemptAt?.toISOString()) {
      await tx.update(publishingJobs).set({
        errorDetails: {
          ...(current.errorDetails && typeof current.errorDetails === 'object' ? current.errorDetails : {}),
          reconciliationConflict: true,
        }, updatedAt: new Date(),
      }).where(eq(publishingJobs.id, current.id));
      return 'contradictory-receipt-retained';
    }
    
    if (!callbackMatchesAttempt(current, parsed.data.dispatchAttempt)) return 'stale-or-unbound-attempt';
    const transition = callbackStateUpdate(current, status, error);
    if (!transition) return 'already-delivered';
    await tx.update(publishingJobs).set({
      ...transition,
      ...(status === 'success' ? { publishedUrl: pageUrl } : { errorDetails: {
        ...(current.errorDetails && typeof current.errorDetails === 'object' ? current.errorDetails : {}),
        callback: parsed.data, reconciliationRequired: true,
      } }),
    }).where(eq(publishingJobs.id, job.id));
    return 'processed';
    });

    return NextResponse.json({
      success: true,
      message: 'Callback processed',
      outcome,
    });
  } catch (error) {
    console.error('Error processing callback:', error);
    return NextResponse.json(
      { error: 'Failed to process callback' },
      { status: 500 }
    );
  }
}
