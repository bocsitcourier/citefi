import type { PublishingConnection } from '../../../../shared/schema';
import type { 
  ChannelAdapter, 
  ValidationResult, 
  PublishableContent, 
  FormattedContent, 
  PublishResult, 
  VerifyResult 
} from '../../types';
import { getOAuthCredentials, isTokenExpired, refreshFacebookToken } from '../social/oauth-service';

interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
}

export class FacebookChannelAdapter implements ChannelAdapter {
  channel = 'facebook' as const;

  async validate(_content: import('../../types').PublishableContent, connection: PublishingConnection): Promise<ValidationResult> {
    try {
      let creds = await getOAuthCredentials(connection.id);
      
      if (!creds) {
        return {
          valid: false,
          errors: ['No OAuth credentials found. Please connect your Facebook account.'],
        };
      }

      if (isTokenExpired(creds.expiresAt)) {
        const refreshResult = await refreshFacebookToken(connection.id);
        if (!refreshResult.success) {
          return {
            valid: false,
            errors: [`Token expired and refresh failed: ${refreshResult.error}. Please reconnect your account.`],
          };
        }
        creds = await getOAuthCredentials(connection.id);
        if (!creds) {
          return { valid: false, errors: ['Failed to retrieve refreshed credentials.'] };
        }
      }

      const pages = creds.platformData?.pages as FacebookPage[] || [];
      if (pages.length === 0) {
        return {
          valid: false,
          errors: ['No Facebook Pages found. You need to manage at least one Facebook Page to publish content.'],
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Unknown validation error'],
      };
    }
  }

  async format(content: PublishableContent, connection: PublishingConnection): Promise<FormattedContent> {
    const parts: string[] = [];
    
    if (content.title) {
      parts.push(content.title);
    }
    
    if (content.description || content.metaDescription) {
      parts.push('');
      parts.push(content.description || content.metaDescription || '');
    }
    
    if (content.url) {
      parts.push('');
      parts.push(`Read more: ${content.url}`);
    }
    
    if (content.hashtags && content.hashtags.length > 0) {
      parts.push('');
      parts.push(content.hashtags.slice(0, 5).map(h => h.startsWith('#') ? h : `#${h}`).join(' '));
    }

    return {
      text: parts.join('\n'),
      mediaUrls: content.mediaUrls ? Object.values(content.mediaUrls) : undefined,
      metadata: {
        link: content.url,
        pageId: connection.baseUrl, // We store page ID in baseUrl for social connections
      },
    };
  }

  async publish(content: FormattedContent, connection: PublishingConnection): Promise<PublishResult> {
    try {
      const creds = await getOAuthCredentials(connection.id);
      if (!creds) {
        return { success: false, error: 'No OAuth credentials found', errorCode: 'NO_CREDENTIALS' };
      }

      const pages = creds.platformData?.pages as FacebookPage[] || [];
      const pageId = content.metadata?.pageId;
      const page = pages.find(p => p.id === pageId) || pages[0];
      
      if (!page || !page.access_token) {
        return { success: false, error: 'No Facebook Page found with valid access token', errorCode: 'NO_PAGE' };
      }

      let endpoint = `https://graph.facebook.com/v18.0/${page.id}/feed`;
      let body: Record<string, string> = {
        message: content.text || '',
        access_token: page.access_token,
      };

      if (content.metadata?.link) {
        body.link = content.metadata.link as string;
      }

      if (content.mediaUrls && content.mediaUrls.length > 0) {
        endpoint = `https://graph.facebook.com/v18.0/${page.id}/photos`;
        body = {
          url: content.mediaUrls[0]!,
          caption: content.text || '',
          access_token: page.access_token,
        };
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (data.error) {
        console.error('Facebook publish error:', data.error);
        return { 
          success: false, 
          error: data.error.message,
          errorCode: data.error.code?.toString(),
        };
      }

      return { 
        success: true, 
        remoteId: data.id,
        remoteUrl: `https://www.facebook.com/${data.id}`,
      };
    } catch (error) {
      console.error('Facebook publish exception:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown publish error',
        errorCode: 'EXCEPTION',
      };
    }
  }

  async verify(publishResult: PublishResult, connection: PublishingConnection): Promise<VerifyResult> {
    if (!publishResult.success || !publishResult.remoteId) {
      return { verified: false, status: 'failed' };
    }

    try {
      const creds = await getOAuthCredentials(connection.id);
      if (!creds) {
        return { verified: false, status: 'unknown' };
      }

      const pages = creds.platformData?.pages as FacebookPage[] || [];
      const page = pages[0];
      
      if (!page?.access_token) {
        return { verified: false, status: 'unknown' };
      }

      const response = await fetch(
        `https://graph.facebook.com/v18.0/${publishResult.remoteId}?access_token=${page.access_token}`
      );
      const data = await response.json();

      if (data.error) {
        return { verified: false, status: 'failed' };
      }

      return { 
        verified: true, 
        status: 'live',
        url: `https://www.facebook.com/${publishResult.remoteId}`,
      };
    } catch {
      return { verified: false, status: 'unknown' };
    }
  }
}

export const facebookAdapter = new FacebookChannelAdapter();
