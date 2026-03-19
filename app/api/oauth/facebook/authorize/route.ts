import { NextRequest, NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { publishingConnections } from '@/shared/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { generateOAuthState } from '@/lib/publishing/channels/social/oauth-service';

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || `${process.env.REPLIT_DOMAINS?.split(',')[0] ? 'https://' + process.env.REPLIT_DOMAINS.split(',')[0] : 'http://localhost:5000'}/api/oauth/facebook/callback`;

const FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_read_user_content',
  'public_profile',
].join(',');

export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);
    
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');

    if (!connectionId) {
      return NextResponse.json({ error: 'Connection ID required' }, { status: 400 });
    }

    if (!FACEBOOK_APP_ID) {
      return NextResponse.json({ 
        error: 'Facebook OAuth not configured',
        message: 'FACEBOOK_APP_ID environment variable is not set'
      }, { status: 503 });
    }

    const [connection] = await db.select()
      .from(publishingConnections)
      .where(and(
        eq(publishingConnections.id, parseInt(connectionId, 10)),
        eq(publishingConnections.teamId, teamId),
        eq(publishingConnections.channel, 'facebook'),
        isNull(publishingConnections.deletedAt)
      ))
      .limit(1);

    if (!connection) {
      return NextResponse.json({ error: 'Facebook connection not found' }, { status: 404 });
    }

    const state = generateOAuthState();

    const stateData = JSON.stringify({
      connectionId: connection.id,
      teamId,
      nonce: state,
    });
    const encodedState = Buffer.from(stateData).toString('base64url');

    const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
    authUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
    authUrl.searchParams.set('redirect_uri', FACEBOOK_REDIRECT_URI);
    authUrl.searchParams.set('state', encodedState);
    authUrl.searchParams.set('scope', FACEBOOK_SCOPES);
    authUrl.searchParams.set('response_type', 'code');

    return NextResponse.json({
      success: true,
      authorizationUrl: authUrl.toString(),
    });
  } catch (error) {
    console.error('Facebook OAuth authorize error:', error);
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to initiate Facebook OAuth' }, { status: 500 });
  }
}
