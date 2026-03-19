import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publishingConnections } from '@/shared/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { storeOAuthCredentials } from '@/lib/publishing/channels/social/oauth-service';

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || `${process.env.REPLIT_DOMAINS?.split(',')[0] ? 'https://' + process.env.REPLIT_DOMAINS.split(',')[0] : 'http://localhost:5000'}/api/oauth/facebook/callback`;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      console.error('Facebook OAuth error:', error, errorDescription);
      return NextResponse.redirect(new URL(`/settings/publishing?error=${encodeURIComponent(errorDescription || error)}`, request.url));
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL('/settings/publishing?error=Missing+code+or+state', request.url));
    }

    if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
      return NextResponse.redirect(new URL('/settings/publishing?error=Facebook+OAuth+not+configured', request.url));
    }

    let stateData: { connectionId: number; teamId: number; nonce: string };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    } catch {
      return NextResponse.redirect(new URL('/settings/publishing?error=Invalid+state', request.url));
    }

    const { connectionId, teamId } = stateData;

    const [connection] = await db.select()
      .from(publishingConnections)
      .where(and(
        eq(publishingConnections.id, connectionId),
        eq(publishingConnections.teamId, teamId),
        eq(publishingConnections.channel, 'facebook'),
        isNull(publishingConnections.deletedAt)
      ))
      .limit(1);

    if (!connection) {
      return NextResponse.redirect(new URL('/settings/publishing?error=Connection+not+found', request.url));
    }

    const tokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
    tokenUrl.searchParams.set('client_secret', FACEBOOK_APP_SECRET);
    tokenUrl.searchParams.set('redirect_uri', FACEBOOK_REDIRECT_URI);
    tokenUrl.searchParams.set('code', code);

    const tokenResponse = await fetch(tokenUrl.toString());
    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('Facebook token error:', tokenData.error);
      return NextResponse.redirect(new URL(`/settings/publishing?error=${encodeURIComponent(tokenData.error.message || 'Token exchange failed')}`, request.url));
    }

    const longLivedUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
    longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longLivedUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
    longLivedUrl.searchParams.set('client_secret', FACEBOOK_APP_SECRET);
    longLivedUrl.searchParams.set('fb_exchange_token', tokenData.access_token);

    const longLivedResponse = await fetch(longLivedUrl.toString());
    const longLivedData = await longLivedResponse.json();

    const accessToken = longLivedData.access_token || tokenData.access_token;
    const expiresIn = longLivedData.expires_in || tokenData.expires_in;

    const meResponse = await fetch(`https://graph.facebook.com/v18.0/me?access_token=${accessToken}`);
    const meData = await meResponse.json();

    const pagesResponse = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`);
    const pagesData = await pagesResponse.json();

    await storeOAuthCredentials(connectionId, {
      accessToken,
      expiresIn,
      scopes: 'pages_show_list,pages_read_engagement,pages_manage_posts',
      platformUserId: meData.id,
      platformUserName: meData.name,
      platformData: {
        pages: pagesData.data || [],
      },
    });

    return NextResponse.redirect(new URL('/settings/publishing?success=Facebook+connected+successfully', request.url));
  } catch (error) {
    console.error('Facebook OAuth callback error:', error);
    return NextResponse.redirect(new URL('/settings/publishing?error=OAuth+callback+failed', request.url));
  }
}
