import type { PublishingConnection } from '../../../../shared/schema';
import type { 
  ChannelAdapter, 
  ValidationResult, 
  PublishableContent, 
  FormattedContent, 
  PublishResult, 
  VerifyResult 
} from '../../types';
import { getOAuthCredentials, isTokenExpired, refreshTikTokToken } from '../social/oauth-service';

export class TikTokChannelAdapter implements ChannelAdapter {
  channel = 'tiktok' as const;

  async validate(_content: PublishableContent, connection: PublishingConnection): Promise<ValidationResult> {
    try {
      let creds = await getOAuthCredentials(connection.id);
      
      if (!creds) {
        return {
          valid: false,
          errors: ['No OAuth credentials found. Please connect your TikTok account.'],
        };
      }

      if (isTokenExpired(creds.expiresAt)) {
        const refreshResult = await refreshTikTokToken(connection.id);
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
    
    if (content.description) {
      parts.push('');
      let desc = content.description.replace(/\.{3,}\s*$/, ".").replace(/…\s*$/, ".").trim();
      if (desc.length > 150) {
        desc = desc.substring(0, 150);
        const lastSpace = desc.lastIndexOf(" ");
        if (lastSpace > 80) desc = desc.substring(0, lastSpace);
        desc = desc.trim();
      }
      parts.push(desc);
    }
    
    if (content.hashtags && content.hashtags.length > 0) {
      parts.push('');
      parts.push(content.hashtags.slice(0, 5).map(h => h.startsWith('#') ? h : `#${h}`).join(' '));
    }

    const videoUrls = content.mediaUrls 
      ? Object.values(content.mediaUrls).filter((url: string) => 
          url.endsWith('.mp4') || url.endsWith('.mov') || url.includes('video')
        )
      : [];
    
    return {
      type: content.type,
      payload: {},
      text: parts.join('\n'),
      // Set mediaUrls so publish() can find the video URLs directly via
      // TikTok's PULL_FROM_URL approach (no separate upload step needed).
      mediaUrls: videoUrls,
      mediaToUpload: videoUrls.map((url, i) => ({
        id: `video_${i}`,
        sourceUrl: url,
        filename: `video_${i}.mp4`,
        mimeType: 'video/mp4',
        type: 'video' as const,
      })),
      metadata: {},
    };
  }

  async publish(content: FormattedContent, connection: PublishingConnection): Promise<PublishResult> {
    try {
      const creds = await getOAuthCredentials(connection.id);
      if (!creds) {
        return { success: false, error: 'No OAuth credentials found', errorCode: 'NO_CREDENTIALS' };
      }

      if (!content.mediaUrls || content.mediaUrls.length === 0) {
        return { success: false, error: 'TikTok requires a video file to publish', errorCode: 'NO_VIDEO' };
      }

      const videoUrl = content.mediaUrls[0]!;

      const initResponse = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          post_info: {
            title: content.text?.substring(0, 150) || 'Video',
            privacy_level: 'PUBLIC_TO_EVERYONE',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: videoUrl,
          },
        }),
      });

      const initData = await initResponse.json();

      if (initData.error?.code) {
        console.error('TikTok init error:', initData.error);
        return { 
          success: false, 
          error: initData.error.message || 'Failed to initialize upload',
          errorCode: initData.error.code,
        };
      }

      const publishId = initData.data?.publish_id;
      if (!publishId) {
        return { 
          success: false, 
          error: 'No publish ID received from TikTok',
          errorCode: 'NO_PUBLISH_ID',
        };
      }

      return { 
        success: true, 
        remoteId: publishId,
        metadata: {
          status: 'processing',
          message: 'Video is being processed by TikTok. Check back later for the final URL.',
        },
      };
    } catch (error) {
      console.error('TikTok publish exception:', error);
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

      const statusResponse = await fetch(
        `https://open.tiktokapis.com/v2/post/publish/status/fetch/?publish_id=${publishResult.remoteId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const statusData = await statusResponse.json();

      if (statusData.data?.status === 'PUBLISH_COMPLETE') {
        return { 
          verified: true, 
          status: 'live',
          url: `https://www.tiktok.com/@${creds.platformUserName}/video/${statusData.data.video_id}`,
        };
      } else if (statusData.data?.status === 'FAILED') {
        return { verified: false, status: 'failed' };
      }

      return { verified: false, status: 'processing' };
    } catch {
      return { verified: false, status: 'unknown' };
    }
  }
}

export const tiktokAdapter = new TikTokChannelAdapter();
