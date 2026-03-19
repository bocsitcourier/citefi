import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { ReceiverResponse } from '../types/payloads';
import { downloadMedia } from '../services/media-downloader';
import { sendCallback, createSuccessCallback, createFailureCallback } from '../services/callbacks';
import { getConfig } from '../config';
import { logger } from '../utils/logger';

const router = Router();

interface VideoPayload {
  id: string;
  title: string;
  description?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  callToAction?: string;
  jobId?: string;
}

interface VideoRequest extends VideoPayload {
  media?: Array<{
    id: string;
    sourceUrl: string;
    filename: string;
    mimeType: string;
    type: string;
    altText?: string;
  }>;
}

router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const video = req.body as VideoRequest;

  if (!video.id || !video.title || !video.videoUrl) {
    res.status(400).json({
      success: false,
      error: 'Missing required fields: id, title, videoUrl',
      errorCode: 'MISSING_REQUIRED_FIELDS',
    } as ReceiverResponse);
    return;
  }

  logger.info('Receiving video', {
    id: video.id,
    title: video.title,
    jobId: video.jobId,
  });

  try {
    const slug = sanitizeSlug(video.title);
    const config = getConfig();

    // Download the main video file
    const videoResult = await downloadMedia({
      id: video.id,
      sourceUrl: video.videoUrl,
      filename: `video-${slug}.mp4`,
      mimeType: 'video/mp4',
      type: 'video',
    });

    // Download thumbnail if provided
    let thumbnailPublicUrl: string | undefined;
    if (video.thumbnailUrl) {
      try {
        const thumbResult = await downloadMedia({
          id: `${video.id}-thumb`,
          sourceUrl: video.thumbnailUrl,
          filename: `thumb-${slug}.jpg`,
          mimeType: 'image/jpeg',
          type: 'image',
        });
        thumbnailPublicUrl = thumbResult.publicUrl;
      } catch (err) {
        logger.warn('Thumbnail download failed (non-fatal)', { id: video.id, error: String(err) });
      }
    }

    // Write HTML page
    const pageHtml = generateVideoPage(video, videoResult.publicUrl, thumbnailPublicUrl);
    const pagesDir = path.join(config.storagePath, '..', 'pages', 'videos');
    await fs.mkdir(pagesDir, { recursive: true });
    const pagePath = path.join(pagesDir, `${slug}.html`);
    await fs.writeFile(pagePath, pageHtml, 'utf-8');

    const pageUrl = `${config.baseUrl}/videos/${slug}`;
    const duration = Date.now() - startTime;

    logger.info('Video processed', {
      id: video.id,
      pageUrl,
      duration,
    });

    res.status(200).json({
      success: true,
      data: {
        id: video.id,
        slug,
        videoUrl: videoResult.publicUrl,
        thumbnailUrl: thumbnailPublicUrl,
        pageUrl,
      },
    } as ReceiverResponse);

    // Send callback asynchronously so it doesn't block the response
    if (video.jobId) {
      sendCallback(createSuccessCallback(video.jobId, pageUrl, slug)).catch(err => {
        logger.error('Failed to send video success callback', { jobId: video.jobId, error: String(err) });
      });
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Video processing failed', { id: video.id, error: errorMessage });

    res.status(500).json({
      success: false,
      error: errorMessage,
      errorCode: 'VIDEO_PROCESSING_ERROR',
    } as ReceiverResponse);

    if (video.jobId) {
      sendCallback(createFailureCallback(video.jobId, errorMessage, 'VIDEO_PROCESSING_ERROR')).catch(err => {
        logger.error('Failed to send video failure callback', { jobId: video.jobId, error: String(err) });
      });
    }
  }
});

function generateVideoPage(video: VideoPayload, videoUrl: string, thumbnailUrl?: string): string {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: video.description || video.title,
    contentUrl: videoUrl,
    thumbnailUrl: thumbnailUrl || videoUrl,
    ...(video.duration && { duration: `PT${video.duration}S` }),
  };

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(video.title)}</title>
  ${video.description ? `<meta name="description" content="${esc(video.description)}">` : ''}
  ${thumbnailUrl ? `<meta property="og:image" content="${esc(thumbnailUrl)}">` : ''}
  <meta property="og:type" content="video.other">
  <meta property="og:title" content="${esc(video.title)}">
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #0a0a0a; color: #fff; }
    h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
    .description { color: #aaa; margin-bottom: 1.5rem; }
    .video-wrap { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 8px; background: #111; }
    .video-wrap video { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
    .cta { margin-top: 1.5rem; padding: 1rem; background: #1a1a2e; border-radius: 8px; border-left: 4px solid #0f3460; }
  </style>
</head>
<body>
  <article>
    <h1>${esc(video.title)}</h1>
    ${video.description ? `<p class="description">${esc(video.description)}</p>` : ''}
    <div class="video-wrap">
      <video controls preload="metadata"${thumbnailUrl ? ` poster="${esc(thumbnailUrl)}"` : ''}>
        <source src="${esc(videoUrl)}" type="video/mp4">
        Your browser does not support HTML5 video.
      </video>
    </div>
    ${video.callToAction ? `<div class="cta"><p>${esc(video.callToAction)}</p></div>` : ''}
  </article>
</body>
</html>`;
}

function sanitizeSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export default router;
