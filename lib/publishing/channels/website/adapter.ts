import type { PublishingConnection, Article, ArticleAsset, VideoIdea } from '../../../../shared/schema';
import type { 
  ChannelAdapter, 
  ValidationResult, 
  PublishableContent, 
  FormattedContent, 
  PublishResult, 
  VerifyResult,
  MediaUpload
} from '../../types';
import { generateSignature } from '../../auth/hmac';

function detectMediaType(url: string): { mimeType: string; extension: string } {
  const lowered = url.toLowerCase();
  
  if (lowered.includes('.png') || lowered.includes('image/png')) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (lowered.includes('.gif') || lowered.includes('image/gif')) {
    return { mimeType: 'image/gif', extension: 'gif' };
  }
  if (lowered.includes('.webp') || lowered.includes('image/webp')) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  if (lowered.includes('.svg') || lowered.includes('image/svg')) {
    return { mimeType: 'image/svg+xml', extension: 'svg' };
  }
  if (lowered.includes('.mp4') || lowered.includes('video/mp4')) {
    return { mimeType: 'video/mp4', extension: 'mp4' };
  }
  if (lowered.includes('.webm') || lowered.includes('video/webm')) {
    return { mimeType: 'video/webm', extension: 'webm' };
  }
  if (lowered.includes('.mp3') || lowered.includes('audio/mpeg')) {
    return { mimeType: 'audio/mpeg', extension: 'mp3' };
  }
  
  return { mimeType: 'image/jpeg', extension: 'jpg' };
}

// Sanitizes metadata string fields for receiver compatibility.
// Receivers may enforce strict character sets on SEO fields like title/metaTitle.
// Replaces: | → " - ", & → " and ", curly quotes → ASCII, en/em dash → " - ".
function sanitizeMetaField(value: string): string {
  return value
    .replace(/\u2018|\u2019|\u201A|\u201B/g, "'")   // curly single quotes → '
    .replace(/\u201C|\u201D|\u201E|\u201F/g, '"')   // curly double quotes → "
    .replace(/\u2013|\u2014/g, ' - ')               // en/em dash → " - "
    .replace(/\s*\|\s*/g, ' - ')                    // pipe → " - "
    .replace(/\s*&\s*/g, ' and ')                   // & → " and "
    .replace(/\s+/g, ' ')                           // collapse whitespace
    .trim();
}

// Converts a relative storage URL to an absolute URL using the engine base URL.
// Priority: NEXTAUTH_URL → NEXT_PUBLIC_APP_URL → REPLIT_DOMAINS (first domain).
// Returns undefined for non-http(s) URI schemes (data:, blob:, etc.) — callers
// must treat undefined as "no image" and omit the field from the payload.
function makeAbsoluteUrl(url: string): string | undefined {
  if (!url) return undefined;

  // Any URI with a scheme other than http/https (e.g. data:, blob:, mailto:)
  // cannot be used as a download source — never prepend a base URL to these.
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url)) {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url; // Valid absolute HTTP URL — use as-is
    }
    // data:, blob:, etc. — not a downloadable URL, signal caller to skip
    return undefined;
  }

  let engineBase = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

  // Auto-detect from Replit's injected domain list when no explicit URL is configured.
  // REPLIT_DOMAINS is comma-separated. In development the list contains ephemeral
  // *.riker.replit.dev addresses that are NOT reachable from the public internet.
  // In production (deployed) the list contains stable *.replit.app addresses.
  // Prefer stable domains (*.replit.app, custom domains) over ephemeral dev ones.
  if (!engineBase && process.env.REPLIT_DOMAINS) {
    const allDomains = process.env.REPLIT_DOMAINS.split(',').map((d) => d.trim()).filter(Boolean);

    // Pick the first stable (non-dev) domain. Ephemeral dev domains contain
    // ".riker.replit.dev" or ".expo.riker.replit.dev".
    const stableDomain = allDomains.find((d) => !d.includes('.riker.replit.dev'));
    const chosenDomain = stableDomain || allDomains[0];

    if (chosenDomain) {
      engineBase = `https://${chosenDomain}`;
    }
  }

  if (engineBase) {
    return `${engineBase}${url}`;
  }

  // No base URL could be determined — return the relative path unchanged.
  // The caller will log a warning; configure NEXTAUTH_URL to fix this.
  console.warn(`[makeAbsoluteUrl] No engine base URL found (NEXTAUTH_URL/NEXT_PUBLIC_APP_URL/REPLIT_DOMAINS not set). Returning relative URL: ${url}`);
  return url;
}

export class WebsiteChannelAdapter implements ChannelAdapter {
  channel = 'website' as const;

  async validate(content: PublishableContent, connection: PublishingConnection): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!connection.baseUrl) {
      errors.push('Base URL is required for website connections');
    } else {
      try {
        new URL(connection.baseUrl);
      } catch {
        errors.push('Invalid base URL format');
      }
    }

    if (!connection.apiKeyHash) {
      errors.push('API key is required for website connections');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  async format(content: PublishableContent, connection: PublishingConnection): Promise<FormattedContent> {
    if (content.type === 'article' && content.article) {
      return this.formatArticle(content.article, content.articleAssets || [], content.businessName);
    }
    if (content.type === 'podcast' && content.article) {
      return this.formatPodcast(content.article);
    }
    if (content.type === 'video' && content.videoIdea) {
      return this.formatVideo(content.videoIdea);
    }
    throw new Error(`Cannot format content: type="${content.type}" — ensure article/videoIdea is populated`);
  }

  private formatArticle(article: Article, articleAssets: ArticleAsset[], businessName?: string): FormattedContent {
    const mediaToUpload: MediaUpload[] = [];

    // Hero image — keyed as 'hero' so page-writer can look it up for the hero section.
    // Skip if heroImageUrl is a placeholder data URI (e.g. SVG fallback from failed generation).
    // A data URI cannot be downloaded by the receiver and causes "Invalid request parameters".
    const heroAbsoluteUrl = article.heroImageUrl ? makeAbsoluteUrl(article.heroImageUrl) : undefined;
    if (heroAbsoluteUrl) {
      const { mimeType, extension } = detectMediaType(article.heroImageUrl!);
      const slug = article.slug || article.publicId;
      mediaToUpload.push({
        id: 'hero',
        sourceUrl: heroAbsoluteUrl,
        filename: `hero-${slug}.${extension}`,
        mimeType,
        type: 'image',
        altText: article.chosenTitle,
      });
    } else if (article.heroImageUrl) {
      console.warn(`[PUBLISH] Skipping hero image (non-http URI scheme) for article ${article.publicId}: ${article.heroImageUrl.slice(0, 40)}...`);
    }

    // Inline images from article_assets — keyed by their relative storageUrl so
    // the page-writer's bodyHtml.replace(originalId, localUrl) rewrites every occurrence.
    const inlineImages: Array<{ id: string; url: string; altText?: string }> = [];
    for (const asset of articleAssets) {
      if (!asset.storageUrl || asset.assetType !== 'image') continue;
      const assetAbsoluteUrl = makeAbsoluteUrl(asset.storageUrl);
      if (!assetAbsoluteUrl) {
        console.warn(`[PUBLISH] Skipping inline asset (non-http URI) for article ${article.publicId}: ${asset.storageUrl.slice(0, 40)}`);
        continue;
      }
      const { mimeType, extension } = detectMediaType(asset.storageUrl);
      mediaToUpload.push({
        id: asset.storageUrl,
        sourceUrl: assetAbsoluteUrl,
        filename: `inline-${asset.publicId}.${extension}`,
        mimeType,
        type: 'image',
        altText: asset.altText || undefined,
      });
      inlineImages.push({
        id: asset.storageUrl,
        url: assetAbsoluteUrl,
        altText: asset.altText || undefined,
      });
    }

    const keywords = Array.isArray(article.keywordsJson) ? (article.keywordsJson as string[]) : [];
    // Filter hashtags: receivers commonly reject tags that don't start with a letter after '#'
    // (e.g. '#02115' zip-code hashtags). Keep only alpha-starting ones.
    const rawHashtags = Array.isArray(article.hashtagsJson) ? (article.hashtagsJson as string[]) : [];
    const hashtags = rawHashtags.filter(tag => /^#[a-zA-Z]/.test(tag));

    // Diagnostic: warn if hero image is missing so operators can re-publish after generation
    if (!article.heroImageUrl) {
      console.warn(`[PUBLISH] ⚠️ Article ${article.publicId} has no hero image — publishing body only (no heroImage field in payload)`);
    }
    if (hashtags.length !== rawHashtags.length) {
      const removed = rawHashtags.filter(tag => !/^#[a-zA-Z]/.test(tag));
      console.log(`[PUBLISH] hashtag-filter slug=${article.slug} removed=${JSON.stringify(removed)} kept=${hashtags.length}`);
    }

    // Extract jsonLd from metaEnrichment if available
    let jsonLd: Record<string, unknown> | undefined;
    if (article.metaEnrichment && typeof article.metaEnrichment === 'object') {
      const enrichment = article.metaEnrichment as Record<string, unknown>;
      if (enrichment.jsonLd) {
        try {
          jsonLd = typeof enrichment.jsonLd === 'string'
            ? JSON.parse(enrichment.jsonLd)
            : (enrichment.jsonLd as Record<string, unknown>);
        } catch {
          // Skip malformed JSON-LD — don't fail the whole publish
        }
      }
    }

    // Strip script/style/iframe tags AND inline event handlers from bodyHtml before
    // sending to receiver. Receivers reject HTML containing on* attributes (onerror,
    // onload, etc.) as an XSS/security violation, returning "Invalid request content".
    // JSON-LD schema is sent separately via the jsonLd field, so stripping it here is safe.
    const rawBodyHtml = article.finalHtmlContent || '';
    const strippedBodyHtml = rawBodyHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
      .replace(/<embed\b[^>]*\/?>/gi, '')
      // Strip ALL inline event handler attributes (onerror, onload, onclick, etc.)
      // These cause receivers to reject with "Invalid request content".
      .replace(/\s+on[a-zA-Z]+\s*=\s*"[^"]*"/gi, '')
      .replace(/\s+on[a-zA-Z]+\s*=\s*'[^']*'/gi, '')
      .trim();

    // CRITICAL: Absolutize all relative /api/public-objects/... paths in bodyHtml.
    // Images are stored as relative paths (so the Replit dev domain can change without
    // breaking the DB). But the receiver is an EXTERNAL site — it resolves relative paths
    // against its own domain, not ours. Replace every relative src/href that points to
    // our object-storage proxy with a full https:// URL the receiver can actually fetch.
    const bodyHtml = strippedBodyHtml.replace(
      /(src|href)="(\/api\/public-objects\/[^"]+)"/gi,
      (_match, attr, path) => {
        const absUrl = makeAbsoluteUrl(path);
        return absUrl ? `${attr}="${absUrl}"` : `${attr}="${path}"`;
      }
    );

    const absolutizedCount = (strippedBodyHtml.match(/\/api\/public-objects\//gi) || []).length;
    if (absolutizedCount > 0) {
      console.log(`[PUBLISH] absolutized ${absolutizedCount} relative image/asset path(s) in bodyHtml for article ${article.publicId}`);
    }

    const rawTitle = article.chosenTitle || '';
    const rawMetaTitle = article.seoTitle || rawTitle;
    const rawMetaDesc = article.metaDescription || '';

    // Log sanitization diffs for diagnostic purposes
    const titleSanitized = sanitizeMetaField(rawTitle);
    const metaTitleSanitized = sanitizeMetaField(rawMetaTitle);
    const metaDescSanitized = sanitizeMetaField(rawMetaDesc);
    if (titleSanitized !== rawTitle || metaTitleSanitized !== rawMetaTitle || metaDescSanitized !== rawMetaDesc) {
      console.log(`[PUBLISH] sanitize slug=${article.slug} title="${titleSanitized.slice(0,80)}" metaTitle="${metaTitleSanitized.slice(0,80)}" metaDesc="${metaDescSanitized.slice(0,80)}..."`);
    }

    const payload = {
      id: article.publicId,
      title: titleSanitized,
      slug: article.slug,
      metaTitle: metaTitleSanitized,
      metaDescription: metaDescSanitized,
      keywords,
      bodyHtml,
      // All terminal "done" statuses → published. Only truly partial/pending → draft.
      // GPT4_ENHANCED is the final status for reformatted articles; COMPLETE for normal pipeline.
      status: ['COMPLETE', 'GPT4_ENHANCED', 'CHATGPT_REVIEWED', 'PUBLISHED'].includes(article.articleStatus || '') ? 'published' : 'draft',
      
      author: {
        // Use the actual business name from the batch; fall back to a generic label
        // only when no business name is configured on the batch.
        name: businessName || 'Content Team',
      },
      
      ...(jsonLd ? { jsonLd } : {}),
      
      openGraph: {
        title: metaTitleSanitized,
        description: metaDescSanitized,
        // Only include image if we have a valid absolute http(s) URL
        ...(heroAbsoluteUrl ? { image: heroAbsoluteUrl } : {}),
        type: 'article',
      },
      
      // Only include heroImage if we have a valid absolute http(s) URL
      ...(heroAbsoluteUrl ? {
        heroImage: {
          id: 'hero',
          url: heroAbsoluteUrl,
          altText: titleSanitized || article.chosenTitle,
        }
      } : {}),

      ...(inlineImages.length > 0 ? { inlineImages } : {}),
      
      hashtags,
    };

    return {
      type: 'article',
      payload,
      mediaToUpload,
    };
  }

  private formatPodcast(article: Article): FormattedContent {
    if (!article.podcastUrl) {
      throw new Error(`Article ${article.publicId} has no podcast audio URL`);
    }

    const podcastAbsoluteUrl = makeAbsoluteUrl(article.podcastUrl);
    if (!podcastAbsoluteUrl) {
      throw new Error(`Article ${article.publicId} podcast URL is not a valid http(s) URL: ${article.podcastUrl.slice(0, 60)}`);
    }

    const { mimeType } = detectMediaType(article.podcastUrl);
    const mediaToUpload: MediaUpload[] = [{
      id: 'podcast-audio',
      sourceUrl: podcastAbsoluteUrl,
      filename: `podcast-${article.slug || article.publicId}.mp3`,
      mimeType: mimeType === 'image/jpeg' ? 'audio/mpeg' : mimeType,
      type: 'audio',
    }];

    const payload = {
      id: article.publicId,
      title: article.chosenTitle,
      slug: `podcast-${article.slug || article.publicId}`,
      description: article.metaDescription || article.chosenTitle,
      audioUrl: podcastAbsoluteUrl,
      duration: article.podcastDuration || 0,
    };

    return {
      type: 'podcast',
      payload,
      mediaToUpload,
    };
  }

  private formatVideo(video: VideoIdea): FormattedContent {
    if (!video.videoUrl) {
      throw new Error(`Video idea ${video.publicId} has no video URL`);
    }

    const videoAbsoluteUrl = makeAbsoluteUrl(video.videoUrl);
    if (!videoAbsoluteUrl) {
      throw new Error(`Video idea ${video.publicId} URL is not a valid http(s) URL: ${video.videoUrl.slice(0, 60)}`);
    }

    const { mimeType, extension } = detectMediaType(video.videoUrl);
    const mediaToUpload: MediaUpload[] = [{
      id: 'video-main',
      sourceUrl: videoAbsoluteUrl,
      filename: `video-${video.publicId}.${extension}`,
      mimeType,
      type: 'video',
    }];

    if (video.thumbnailUrl) {
      const thumbAbsoluteUrl = makeAbsoluteUrl(video.thumbnailUrl);
      if (thumbAbsoluteUrl) {
        const thumb = detectMediaType(video.thumbnailUrl);
        mediaToUpload.push({
          id: 'video-thumbnail',
          sourceUrl: thumbAbsoluteUrl,
          filename: `thumb-${video.publicId}.${thumb.extension}`,
          mimeType: thumb.mimeType,
          type: 'image',
          altText: video.ideaTitle,
        });
      }
    }

    const thumbnailAbsoluteUrl = video.thumbnailUrl ? makeAbsoluteUrl(video.thumbnailUrl) : undefined;
    const payload = {
      id: video.publicId,
      title: video.ideaTitle,
      description: video.shortIdea,
      videoUrl: videoAbsoluteUrl,
      ...(thumbnailAbsoluteUrl ? { thumbnailUrl: thumbnailAbsoluteUrl } : {}),
      duration: video.videoDuration || 60,
      callToAction: video.callToAction,
    };

    return {
      type: 'video',
      payload,
      mediaToUpload,
    };
  }

  async publish(
    content: FormattedContent,
    connection: PublishingConnection,
    apiKey: string,
    jobId: string
  ): Promise<PublishResult> {
    if (!connection.baseUrl) {
      return {
        success: false,
        error: 'Connection missing base URL',
        errorCode: 'MISSING_BASE_URL',
      };
    }

    const endpointMap: Record<string, string> = {
      article: '/api/v1/articles',
      podcast: '/api/v1/podcasts',
      video: '/api/v1/media',
      social_post: '/api/v1/articles',
    };

    // Use only the origin (protocol + host) — never include any path from baseUrl.
    // baseUrl may contain a content path like /blog or /articles (e.g. the WordPress
    // subdirectory where articles are displayed) but the receiver API is always rooted
    // at the domain origin, e.g. https://example.com/api/v1/articles.
    const receiverOrigin = new URL(connection.baseUrl).origin;
    const endpoint = `${receiverOrigin}${endpointMap[content.type ?? ''] || '/api/v1/articles'}`;
    const payload = {
      ...content.payload,
      jobId,
      media: content.mediaToUpload,
    };

    const body = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const signature = generateSignature(body, apiKey, timestamp);

    // Diagnostic: log outbound payload structure (never log full body or signature)
    const payloadFields: Record<string, unknown> = {};
    for (const k of Object.keys(payload)) {
      const v = (payload as Record<string, unknown>)[k];
      if (v === null || v === undefined) {
        payloadFields[k] = 'null/undefined';
      } else if (typeof v === 'string') {
        payloadFields[k] = `string(${(v as string).length})`;
      } else if (Array.isArray(v)) {
        payloadFields[k] = `array(${(v as unknown[]).length})`;
      } else if (typeof v === 'object') {
        payloadFields[k] = `object{${Object.keys(v as object).join(',')}}`;
      } else {
        payloadFields[k] = typeof v;
      }
    }
    console.log(`[PUBLISH] → ${endpoint} | jobId=${jobId} | bodyBytes=${body.length} | fields:`, JSON.stringify(payloadFields));

    // URL checks for diagnosing relative URL issues
    const pAny = payload as Record<string, unknown>;
    const ogImage = (pAny.openGraph as Record<string, unknown> | undefined)?.image;
    const heroUrl = (pAny.heroImage as Record<string, unknown> | undefined)?.url;
    const mediaCount = (pAny.media as unknown[] | undefined)?.length ?? 0;
    const inlineImgUrls = ((pAny.inlineImages as Array<Record<string,unknown>> | undefined) || []).map(i => String(i.url || '').slice(0, 80));
    console.log(`[PUBLISH] URLs → og.image="${String(ogImage || 'none').slice(0,100)}" hero.url="${String(heroUrl || 'none').slice(0,100)}" media=${mediaCount} inline=${inlineImgUrls.length} slug="${pAny.slug}"`);
    if (inlineImgUrls.length > 0) {
      console.log(`[PUBLISH] inlineImages → ${JSON.stringify(inlineImgUrls)}`);
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Apex-Signature': signature,
          'X-Apex-Timestamp': timestamp,
          // Some receiver deployments check X-Api-Key directly (plain key) in addition
          // to or instead of the HMAC X-Apex-Signature scheme.
          'X-Api-Key': apiKey,
        },
        body,
      });

      const rawText = await response.text();
      console.log(`[PUBLISH] ← status=${response.status} contentType="${response.headers.get('content-type')}" body=${rawText.slice(0, 600)}`);

      let result: Record<string, unknown> = {};
      try {
        result = JSON.parse(rawText);
      } catch {
        // Non-JSON response (e.g. HTML from Apache when receiver is down)
        return {
          success: false,
          error: `Non-JSON response (HTTP ${response.status}): ${rawText.slice(0, 200)}`,
          errorCode: 'RECEIVER_DOWN',
        };
      }

      // Detailed diagnostics for any 400 rejection (covers "Invalid request content",
      // "Invalid request parameters", and any other receiver validation failures).
      if (response.status === 400) {
        const p = payload as Record<string, unknown>;
        console.log(`[PUBLISH-400] slug="${p.slug}" id="${p.id}" title="${String(p.title).slice(0,80)}" metaTitle="${String(p.metaTitle || '').slice(0,80)}" status="${p.status}"`);
        console.log(`[PUBLISH-400] keywords=${JSON.stringify(p.keywords).slice(0,300)}`);
        console.log(`[PUBLISH-400] hashtags=${JSON.stringify(p.hashtags).slice(0,300)}`);
        console.log(`[PUBLISH-400] bodyHtml_first200="${String(p.bodyHtml || '').slice(0,200).replace(/\n/g,' ')}"`);
        const hero = p.heroImage as Record<string,unknown> | undefined;
        console.log(`[PUBLISH-400] heroImage=${JSON.stringify({ id: hero?.id, altText: String(hero?.altText || '').slice(0,80), url: String(hero?.url || '') })}`);
        const inlineImgs = p.inlineImages as Array<Record<string,unknown>> | undefined;
        console.log(`[PUBLISH-400] inlineImages=${JSON.stringify((inlineImgs || []).map(i => ({ id: String(i.id || ''), url: String(i.url || '') })))}`);
        const media = p.media as Array<Record<string,unknown>> | undefined;
        console.log(`[PUBLISH-400] media=${JSON.stringify((media || []).map(m => ({ id: String(m.id || '').slice(0,80), sourceUrl: String(m.sourceUrl || '').slice(0,80), type: m.type, mimeType: m.mimeType, filename: m.filename })))}`);
      }

      if (response.ok && result.success) {
        return {
          success: true,
          publishedUrl: result.data ? (result.data as Record<string, unknown>).pageUrl as string : undefined,
          platformPostId: result.data ? ((result.data as Record<string, unknown>).slug || (result.data as Record<string, unknown>).id) as string : undefined,
          rawResponse: result,
        };
      }

      return {
        success: false,
        error: (result.error as string) || 'Publishing failed',
        errorCode: (result.errorCode as string) || 'PUBLISH_FAILED',
        rawResponse: result,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Network error';
      console.log(`[PUBLISH] ✗ fetch threw: ${msg}`);
      return {
        success: false,
        error: msg,
        errorCode: 'NETWORK_ERROR',
      };
    }
  }

  async verify(publishResult: PublishResult, connection: PublishingConnection): Promise<VerifyResult> {
    if (!publishResult.success || !publishResult.publishedUrl) {
      return {
        verified: false,
        status: 'failed',
      };
    }

    try {
      const response = await fetch(publishResult.publishedUrl, {
        method: 'HEAD',
      });

      return {
        verified: response.ok,
        status: response.ok ? 'published' : 'failed',
        details: {
          statusCode: response.status,
          url: publishResult.publishedUrl,
        },
      };
    } catch {
      return {
        verified: false,
        status: 'pending',
        details: {
          message: 'Could not verify page — may still be processing',
        },
      };
    }
  }
}

export const websiteAdapter = new WebsiteChannelAdapter();
