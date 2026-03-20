import type { PublishingConnection, PublishingJob, Article, ArticleAsset, SocialPost, VideoIdea } from '../../shared/schema';

export type PublishingChannel = 'website' | 'facebook' | 'linkedin' | 'tiktok';

export interface ChannelAdapter {
  channel: PublishingChannel;
  
  validate(content: PublishableContent, connection: PublishingConnection): Promise<ValidationResult>;
  
  format(content: PublishableContent, connection: PublishingConnection): Promise<FormattedContent>;
  
  publish(
    content: FormattedContent, 
    connection: PublishingConnection,
    apiKey: string,
    jobId: string
  ): Promise<PublishResult>;
  
  verify(publishResult: PublishResult, connection: PublishingConnection): Promise<VerifyResult>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface PublishableContent {
  type: 'article' | 'social_post' | 'video' | 'podcast';
  article?: Article;
  articleAssets?: ArticleAsset[];
  socialPost?: SocialPost;
  videoIdea?: VideoIdea;
  mediaUrls?: Record<string, string>;
  title?: string;
  description?: string;
  metaDescription?: string;
  url?: string;
  hashtags?: string[];
  caption?: string;
  imageUrl?: string;
  videoUrl?: string;
}

export interface FormattedContent {
  type?: 'article' | 'social_post' | 'video' | 'podcast';
  payload?: Record<string, unknown>;
  mediaToUpload?: MediaUpload[];
  mediaUrls?: string[];
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface MediaUpload {
  id: string;
  sourceUrl: string;
  filename: string;
  mimeType: string;
  type: 'image' | 'video' | 'audio';
  altText?: string;
}

export interface PublishResult {
  success: boolean;
  publishedUrl?: string;
  platformPostId?: string;
  remoteId?: string;
  remoteUrl?: string;
  error?: string;
  errorCode?: string;
  rawResponse?: unknown;
  metadata?: Record<string, unknown>;
}

export interface VerifyResult {
  verified: boolean;
  status: 'published' | 'pending' | 'failed' | 'deleted' | 'live' | 'unknown' | 'processing';
  url?: string;
  details?: Record<string, unknown>;
}

export interface CallbackPayload {
  jobId: string;
  status: 'success' | 'failure' | 'partial' | 'retryable';
  pageUrl?: string;
  slug?: string;
  mediaUrls?: Record<string, string>;
  error?: string;
  errorCode?: string;
  timestamp: string;
}
