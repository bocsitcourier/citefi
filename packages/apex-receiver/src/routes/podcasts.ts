import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { PodcastPayload, ReceiverResponse } from '../types/payloads';
import { localStorage } from '../storage/localFilesystem';
import { sendCallback, createSuccessCallback, createFailureCallback } from '../services/callbacks';
import { getConfig } from '../config';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';

const router = Router();

interface PodcastRequest extends PodcastPayload {
  jobId?: string;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const podcast = req.body as PodcastRequest;
    
    if (!podcast.id || !podcast.title || !podcast.audioUrl) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: id, title, audioUrl',
        errorCode: 'MISSING_REQUIRED_FIELDS',
      } as ReceiverResponse);
      return;
    }
    
    logger.info('Receiving podcast', {
      id: podcast.id,
      title: podcast.title,
      jobId: podcast.jobId,
    });
    
    const uniqueId = nanoid(8);
    const slug = sanitizeSlug(podcast.slug || podcast.title);
    const audioFilename = `${slug}-${uniqueId}.mp3`;
    const audioPath = path.join('audio', audioFilename);
    
    const result = await localStorage.downloadAndStore(podcast.audioUrl, audioPath);
    
    const pageHtml = generatePodcastPage(podcast, result.publicUrl);
    const pagesDir = path.join(getConfig().storagePath, '..', 'pages', 'podcasts');
    await fs.mkdir(pagesDir, { recursive: true });
    
    const pagePath = path.join(pagesDir, `${slug}.html`);
    await fs.writeFile(pagePath, pageHtml, 'utf-8');
    
    const pageUrl = `${getConfig().baseUrl}/podcasts/${slug}`;
    
    logger.info('Podcast processed', {
      id: podcast.id,
      audioUrl: result.publicUrl,
      pageUrl,
    });
    
    res.status(200).json({
      success: true,
      data: {
        id: podcast.id,
        slug,
        audioUrl: result.publicUrl,
        pageUrl,
      },
    } as ReceiverResponse);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('Podcast processing failed', {
      id: req.body?.id,
      error: errorMessage,
    });
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      errorCode: 'PODCAST_PROCESSING_ERROR',
    } as ReceiverResponse);
  }
});

function generatePodcastPage(podcast: PodcastPayload, audioUrl: string): string {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    name: podcast.title,
    description: podcast.description,
    url: audioUrl,
    duration: formatDuration(podcast.duration),
    ...(podcast.episodeNumber && { episodeNumber: podcast.episodeNumber }),
    ...(podcast.seasonNumber && { partOfSeason: { '@type': 'PodcastSeason', seasonNumber: podcast.seasonNumber } }),
  };
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(podcast.title)}</title>
  <meta name="description" content="${escapeHtml(podcast.description)}">
  
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>
  
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 2rem; }
    .audio-player { width: 100%; margin: 2rem 0; }
    .transcript { margin-top: 2rem; padding: 1rem; background: #f5f5f5; border-radius: 8px; }
  </style>
</head>
<body>
  <article>
    <h1>${escapeHtml(podcast.title)}</h1>
    <p>${escapeHtml(podcast.description)}</p>
    
    <audio class="audio-player" controls preload="metadata">
      <source src="${audioUrl}" type="audio/mpeg">
      Your browser does not support the audio element.
    </audio>
    
    ${podcast.transcript ? `
    <div class="transcript">
      <h2>Transcript</h2>
      <p>${escapeHtml(podcast.transcript)}</p>
    </div>
    ` : ''}
  </article>
</body>
</html>`;
}

function sanitizeSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, char => escapeMap[char] ?? '');
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `PT${hours > 0 ? hours + 'H' : ''}${minutes}M${secs}S`;
}

export default router;
