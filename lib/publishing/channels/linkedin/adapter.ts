import type { PublishingConnection } from '../../../../shared/schema';
import type { 
  ChannelAdapter, 
  ValidationResult, 
  PublishableContent, 
  FormattedContent, 
  PublishResult, 
  VerifyResult 
} from '../../types';
import { getOAuthCredentials, isTokenExpired, refreshLinkedInToken } from '../social/oauth-service';

export class LinkedInChannelAdapter implements ChannelAdapter {
  channel = 'linkedin' as const;

  async validate(connection: PublishingConnection): Promise<ValidationResult> {
    try {
      let creds = await getOAuthCredentials(connection.id);
      
      if (!creds) {
        return {
          valid: false,
          errors: ['No OAuth credentials found. Please connect your LinkedIn account.'],
        };
      }

      if (isTokenExpired(creds.expiresAt)) {
        const refreshResult = await refreshLinkedInToken(connection.id);
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
      parts.push(content.url);
    }
    
    if (content.hashtags && content.hashtags.length > 0) {
      parts.push('');
      parts.push(content.hashtags.slice(0, 3).map(h => h.startsWith('#') ? h : `#${h}`).join(' '));
    }

    return {
      text: parts.join('\n'),
      mediaUrls: content.mediaUrls,
      metadata: {},
    };
  }

  async publish(content: FormattedContent, connection: PublishingConnection): Promise<PublishResult> {
    try {
      const creds = await getOAuthCredentials(connection.id);
      if (!creds) {
        return { success: false, error: 'No OAuth credentials found', errorCode: 'NO_CREDENTIALS' };
      }

      if (!creds.platformUserId) {
        return { success: false, error: 'LinkedIn user ID not found', errorCode: 'NO_USER_ID' };
      }

      const author = `urn:li:person:${creds.platformUserId}`;

      const postData: Record<string, unknown> = {
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: content.text || '',
            },
            shareMediaCategory: content.mediaUrls && content.mediaUrls.length > 0 ? 'IMAGE' : 'NONE',
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      };

      if (content.mediaUrls && content.mediaUrls.length > 0) {
        const registerResponse = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            registerUploadRequest: {
              recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
              owner: author,
              serviceRelationships: [{
                relationshipType: 'OWNER',
                identifier: 'urn:li:userGeneratedContent',
              }],
            },
          }),
        });

        const registerData = await registerResponse.json();
        
        if (registerData.value) {
          const uploadUrl = registerData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
          const asset = registerData.value.asset;

          const imageResponse = await fetch(content.mediaUrls[0]);
          const imageBuffer = await imageResponse.arrayBuffer();

          await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${creds.accessToken}`,
              'Content-Type': 'image/jpeg',
            },
            body: imageBuffer,
          });

          (postData.specificContent as Record<string, unknown>)['com.linkedin.ugc.ShareContent'] = {
            ...((postData.specificContent as Record<string, unknown>)['com.linkedin.ugc.ShareContent'] as Record<string, unknown>),
            media: [{
              status: 'READY',
              media: asset,
            }],
          };
        }
      }

      const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(postData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('LinkedIn publish error:', errorData);
        return { 
          success: false, 
          error: errorData.message || `HTTP ${response.status}`,
          errorCode: response.status.toString(),
        };
      }

      const postId = response.headers.get('x-restli-id');

      return { 
        success: true, 
        remoteId: postId || undefined,
        remoteUrl: postId ? `https://www.linkedin.com/feed/update/${postId}` : undefined,
      };
    } catch (error) {
      console.error('LinkedIn publish exception:', error);
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

    return { 
      verified: true, 
      status: 'live',
      url: publishResult.remoteUrl,
    };
  }
}

export const linkedinAdapter = new LinkedInChannelAdapter();
