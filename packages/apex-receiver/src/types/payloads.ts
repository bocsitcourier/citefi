export interface ArticlePayload {
  id: string;
  title: string;
  slug: string;
  category?: string;
  excerpt?: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  bodyHtml: string;
  status: 'draft' | 'published' | 'scheduled';
  publishAt?: string;
  
  author?: {
    name: string;
    url?: string;
    credentials?: string;
  };
  
  location?: {
    city?: string;
    state?: string;
    country?: string;
    zipCode?: string;
    neighborhood?: string;
  };
  
  jsonLd?: Record<string, unknown>;
  openGraph?: {
    title?: string;
    description?: string;
    image?: string;
    type?: string;
  };
  
  canonicalUrl?: string;
  heroImage?: MediaReference;
  inlineImages?: MediaReference[];
  hashtags?: string[];
  
  hyperlinks?: Array<{
    text: string;
    url: string;
    rel?: string;
  }>;

  /**
   * ApexContent Engine beacon script URL.
   * When provided, the receiver injects:
   *   <script src="{beaconScriptUrl}"
   *     data-team-id="{beaconTeamId}"
   *     data-content-type="article"
   *     data-content-id="{beaconContentId}"
   *     data-engine-url="{engineUrl}"
   *   ></script>
   * into the generated HTML page's <head> to enable engagement tracking.
   */
  beaconScriptUrl?: string;
  beaconTeamId?: number;
  beaconContentId?: number | string;
}

export interface MediaReference {
  id: string;
  url: string;
  altText?: string;
  caption?: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface MediaPayload {
  id: string;
  type: 'image' | 'video' | 'audio';
  sourceUrl: string;
  filename: string;
  altText?: string;
  caption?: string;
  mimeType: string;
  size?: number;
  // Platinum: base64-encoded image data — when present, receiver uses this
  // directly instead of downloading from sourceUrl (no hotlinking, no network dep)
  base64Data?: string;
  
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
    transcript?: string;
  };
}

export interface PodcastPayload {
  id: string;
  title: string;
  slug: string;
  description: string;
  audioUrl: string;
  transcript?: string;
  duration: number;
  episodeNumber?: number;
  seasonNumber?: number;
  
  metadata?: {
    artist?: string;
    album?: string;
    genre?: string;
  };
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

export interface ReceiverResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}
