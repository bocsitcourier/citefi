import crypto from 'crypto';
import { db } from '@/lib/db';
import { oauthCredentials, publishingConnections } from '@/shared/schema';
import { eq } from 'drizzle-orm';

const ENCRYPTION_ALGORITHM = 'aes-256-cbc';

function getEncryptionSecret(): string {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('API_KEY_ENCRYPTION_SECRET must be set and at least 32 characters');
  }
  return secret;
}

function encrypt(text: string): string {
  const ENCRYPTION_SECRET = getEncryptionSecret();
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText: string): string {
  const ENCRYPTION_SECRET = getEncryptionSecret();
  const [ivHex, encrypted] = encryptedText.split(':');
  if (!ivHex || !encrypted) throw new Error('Invalid encrypted text format');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scopes?: string;
  platformUserId?: string;
  platformUserName?: string;
  platformData?: Record<string, any>;
}

export async function storeOAuthCredentials(
  connectionId: number,
  tokens: OAuthTokens
): Promise<void> {
  const encryptedAccessToken = encrypt(tokens.accessToken);
  const encryptedRefreshToken = tokens.refreshToken ? encrypt(tokens.refreshToken) : null;
  
  const expiresAt = tokens.expiresIn 
    ? new Date(Date.now() + tokens.expiresIn * 1000) 
    : null;

  const existing = await db.select()
    .from(oauthCredentials)
    .where(eq(oauthCredentials.connectionId, connectionId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(oauthCredentials)
      .set({
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt,
        scopes: tokens.scopes,
        platformUserId: tokens.platformUserId,
        platformUserName: tokens.platformUserName,
        platformData: tokens.platformData,
        updatedAt: new Date(),
      })
      .where(eq(oauthCredentials.connectionId, connectionId));
  } else {
    await db.insert(oauthCredentials).values({
      connectionId,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt,
      scopes: tokens.scopes,
      platformUserId: tokens.platformUserId,
      platformUserName: tokens.platformUserName,
      platformData: tokens.platformData,
    });
  }

  await db.update(publishingConnections)
    .set({ 
      status: 'active',
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(publishingConnections.id, connectionId));
}

export async function getOAuthCredentials(connectionId: number): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date | null;
  platformUserId?: string;
  platformUserName?: string;
  platformData?: Record<string, any>;
} | null> {
  const [creds] = await db.select()
    .from(oauthCredentials)
    .where(eq(oauthCredentials.connectionId, connectionId))
    .limit(1);

  if (!creds) return null;

  try {
    return {
      accessToken: decrypt(creds.accessToken),
      refreshToken: creds.refreshToken ? decrypt(creds.refreshToken) : undefined,
      expiresAt: creds.expiresAt,
      platformUserId: creds.platformUserId || undefined,
      platformUserName: creds.platformUserName || undefined,
      platformData: creds.platformData as Record<string, any> | undefined,
    };
  } catch (error) {
    console.error('Failed to decrypt OAuth credentials:', error);
    return null;
  }
}

export function isTokenExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return new Date() > new Date(expiresAt.getTime() - 5 * 60 * 1000);
}

export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function refreshFacebookToken(connectionId: number): Promise<{ success: boolean; error?: string }> {
  const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
  const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
  
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    return { success: false, error: 'Facebook OAuth not configured' };
  }

  const creds = await getOAuthCredentials(connectionId);
  if (!creds) {
    return { success: false, error: 'No credentials found' };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${FACEBOOK_APP_ID}&client_secret=${FACEBOOK_APP_SECRET}&fb_exchange_token=${creds.accessToken}`
    );
    const data = await response.json();

    if (data.error) {
      return { success: false, error: data.error.message };
    }

    await storeOAuthCredentials(connectionId, {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Refresh failed' };
  }
}

export async function refreshLinkedInToken(connectionId: number): Promise<{ success: boolean; error?: string }> {
  const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
  const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
  
  if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
    return { success: false, error: 'LinkedIn OAuth not configured' };
  }

  const creds = await getOAuthCredentials(connectionId);
  if (!creds || !creds.refreshToken) {
    return { success: false, error: 'No refresh token available' };
  }

  try {
    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
      }).toString(),
    });
    const data = await response.json();

    if (data.error) {
      return { success: false, error: data.error_description || data.error };
    }

    await storeOAuthCredentials(connectionId, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Refresh failed' };
  }
}

export async function refreshTikTokToken(connectionId: number): Promise<{ success: boolean; error?: string }> {
  const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
  const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
  
  if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
    return { success: false, error: 'TikTok OAuth not configured' };
  }

  const creds = await getOAuthCredentials(connectionId);
  if (!creds || !creds.refreshToken) {
    return { success: false, error: 'No refresh token available' };
  }

  try {
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
      }).toString(),
    });
    const data = await response.json();

    if (data.error) {
      return { success: false, error: data.error_description || data.error };
    }

    await storeOAuthCredentials(connectionId, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Refresh failed' };
  }
}
