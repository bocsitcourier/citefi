import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publishingConnections } from '@/shared/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { storeOAuthCredentials, verifyOAuthState } from '@/lib/publishing/channels/social/oauth-service';

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || `${process.env.REPLIT_DOMAINS?.split(',')[0] ? 'https://' + process.env.REPLIT_DOMAINS.split(',')[0] : 'http://localhost:5000'}/api/oauth/linkedin/callback`;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      console.error('LinkedIn OAuth error:', error, errorDescription);
      return NextResponse.redirect(new URL(`/settings/publishing?error=${encodeURIComponent(errorDescription || error)}`, request.url));
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL('/settings/publishing?error=Missing+code+or+state', request.url));
    }

    if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
      return NextResponse.redirect(new URL('/settings/publishing?error=LinkedIn+OAuth+not+configured', request.url));
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
        eq(publishingConnections.channel, 'linkedin'),
        isNull(publishingConnections.deletedAt)
      ))
      .limit(1);

    if (!connection) {
      return NextResponse.redirect(new URL('/settings/publishing?error=Connection+not+found', request.url));
    }

    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LINKEDIN_REDIRECT_URI,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
      }).toString(),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('LinkedIn token error:', tokenData.error);
      return NextResponse.redirect(new URL(`/settings/publishing?error=${encodeURIComponent(tokenData.error_description || 'Token exchange failed')}`, request.url));
    }

    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });
    const profileData = await profileResponse.json();

    await storeOAuthCredentials(connectionId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      scopes: tokenData.scope,
      platformUserId: profileData.sub,
      platformUserName: profileData.name || profileData.given_name,
      platformData: {
        email: profileData.email,
        picture: profileData.picture,
      },
    });

    return NextResponse.redirect(new URL('/settings/publishing?success=LinkedIn+connected+successfully', request.url));
  } catch (error) {
    console.error('LinkedIn OAuth callback error:', error);
    return NextResponse.redirect(new URL('/settings/publishing?error=OAuth+callback+failed', request.url));
  }
}
