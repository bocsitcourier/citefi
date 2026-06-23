import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publishingConnections } from '@/shared/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { storeOAuthCredentials, verifyOAuthState } from '@/lib/publishing/channels/social/oauth-service';

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || `${process.env.REPLIT_DOMAINS?.split(',')[0] ? 'https://' + process.env.REPLIT_DOMAINS.split(',')[0] : 'http://localhost:5000'}/api/oauth/tiktok/callback`;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      console.error('TikTok OAuth error:', error, errorDescription);
      return NextResponse.redirect(new URL(`/settings/publishing?error=${encodeURIComponent(errorDescription || error)}`, request.url));
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL('/settings/publishing?error=Missing+code+or+state', request.url));
    }

    if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
      return NextResponse.redirect(new URL('/settings/publishing?error=TikTok+OAuth+not+configured', request.url));
    }

    let stateData: { connectionId: number; teamId: number; nonce: string };
    try {
      stateData = verifyOAuthState(state);
    } catch {
      return NextResponse.redirect(new URL('/settings/publishing?error=Invalid+state', request.url));
    }

    const { connectionId, teamId } = stateData;

    const [connection] = await db.select()
      .from(publishingConnections)
      .where(and(
        eq(publishingConnections.id, connectionId),
        eq(publishingConnections.teamId, teamId),
        eq(publishingConnections.channel, 'tiktok'),
        isNull(publishingConnections.deletedAt)
      ))
      .limit(1);

    if (!connection) {
      return NextResponse.redirect(new URL('/settings/publishing?error=Connection+not+found', request.url));
    }

    const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TIKTOK_REDIRECT_URI,
      }).toString(),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('TikTok token error:', tokenData.error);
      return NextResponse.redirect(new URL(`/settings/publishing?error=${encodeURIComponent(tokenData.error_description || 'Token exchange failed')}`, request.url));
    }

    const userInfoResponse = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });
    const userInfo = await userInfoResponse.json();

    await storeOAuthCredentials(connectionId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      scopes: tokenData.scope,
      platformUserId: tokenData.open_id || userInfo.data?.user?.open_id,
      platformUserName: userInfo.data?.user?.display_name,
      platformData: {
        avatarUrl: userInfo.data?.user?.avatar_url,
        refreshExpiresIn: tokenData.refresh_expires_in,
      },
    });

    return NextResponse.redirect(new URL('/settings/publishing?success=TikTok+connected+successfully', request.url));
  } catch (error) {
    console.error('TikTok OAuth callback error:', error);
    return NextResponse.redirect(new URL('/settings/publishing?error=OAuth+callback+failed', request.url));
  }
}
