import { NextRequest, NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { publishingConnections } from '@/shared/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { generateOAuthState } from '@/lib/publishing/channels/social/oauth-service';

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || `${process.env.REPLIT_DOMAINS?.split(',')[0] ? 'https://' + process.env.REPLIT_DOMAINS.split(',')[0] : 'http://localhost:5000'}/api/oauth/linkedin/callback`;

const LINKEDIN_SCOPES = [
  'openid',
  'profile',
  'w_member_social',
].join(' ');

export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);
    
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');

    if (!connectionId) {
      return NextResponse.json({ error: 'Connection ID required' }, { status: 400 });
    }

    if (!LINKEDIN_CLIENT_ID) {
      return NextResponse.json({ 
        error: 'LinkedIn OAuth not configured',
        message: 'LINKEDIN_CLIENT_ID environment variable is not set'
      }, { status: 503 });
    }

    const [connection] = await db.select()
      .from(publishingConnections)
      .where(and(
        eq(publishingConnections.id, parseInt(connectionId, 10)),
        eq(publishingConnections.teamId, teamId),
        eq(publishingConnections.channel, 'linkedin'),
        isNull(publishingConnections.deletedAt)
      ))
      .limit(1);

    if (!connection) {
      return NextResponse.json({ error: 'LinkedIn connection not found' }, { status: 404 });
    }

    const state = generateOAuthState();
    const stateData = JSON.stringify({
      connectionId: connection.id,
      teamId,
      nonce: state,
    });
    const encodedState = Buffer.from(stateData).toString('base64url');

    const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', LINKEDIN_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', LINKEDIN_REDIRECT_URI);
    authUrl.searchParams.set('state', encodedState);
    authUrl.searchParams.set('scope', LINKEDIN_SCOPES);

    return NextResponse.json({
      success: true,
      authorizationUrl: authUrl.toString(),
    });
  } catch (error) {
    console.error('LinkedIn OAuth authorize error:', error);
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to initiate LinkedIn OAuth' }, { status: 500 });
  }
}
