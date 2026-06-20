import { NextRequest, NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { publishingConnections } from '@/shared/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { generateOAuthState } from '@/lib/publishing/channels/social/oauth-service';

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || `${process.env.REPLIT_DOMAINS?.split(',')[0] ? 'https://' + process.env.REPLIT_DOMAINS.split(',')[0] : 'http://localhost:5000'}/api/oauth/tiktok/callback`;

const TIKTOK_SCOPES = [
  'user.info.basic',
  'video.publish',
  'video.upload',
].join(',');

export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);
    
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');

    if (!connectionId) {
      return NextResponse.json({ error: 'Connection ID required' }, { status: 400 });
    }

    if (!TIKTOK_CLIENT_KEY) {
      return NextResponse.json({ 
        error: 'TikTok OAuth not configured',
        message: 'TIKTOK_CLIENT_KEY environment variable is not set'
      }, { status: 503 });
    }

    const [connection] = await db.select()
      .from(publishingConnections)
      .where(and(
        eq(publishingConnections.id, parseInt(connectionId, 10)),
        eq(publishingConnections.teamId, teamId),
        eq(publishingConnections.channel, 'tiktok'),
        isNull(publishingConnections.deletedAt)
      ))
      .limit(1);

    if (!connection) {
      return NextResponse.json({ error: 'TikTok connection not found' }, { status: 404 });
    }

    const state = generateOAuthState();
    const stateData = JSON.stringify({
      connectionId: connection.id,
      teamId,
      nonce: state,
    });
    const encodedState = Buffer.from(stateData).toString('base64url');

    const csrfState = encodedState;

    const authUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
    authUrl.searchParams.set('client_key', TIKTOK_CLIENT_KEY);
    authUrl.searchParams.set('scope', TIKTOK_SCOPES);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', TIKTOK_REDIRECT_URI);
    authUrl.searchParams.set('state', csrfState);

    return NextResponse.json({
      success: true,
      authorizationUrl: authUrl.toString(),
    });
  } catch (error: any) {
    console.error('TikTok OAuth authorize error:', error);
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to initiate TikTok OAuth' }, { status: error?.statusCode || 500 });
  }
}
