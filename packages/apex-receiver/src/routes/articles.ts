import { Router, Request, Response } from 'express';
import { ArticlePayload, MediaPayload, ReceiverResponse } from '../types/payloads';
import { downloadMultipleMedia } from '../services/media-downloader';
import { sendCallback, createSuccessCallback, createFailureCallback } from '../services/callbacks';
import { getLocalStorage } from '../storage/localFilesystem';
import { logger } from '../utils/logger';

const router = Router();

interface ArticleRequest extends ArticlePayload {
  jobId: string;
  media?: MediaPayload[];
}

router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const article = req.body as ArticleRequest;
    
    if (!article.jobId) {
      res.status(400).json({
        success: false,
        error: 'Missing jobId',
        errorCode: 'MISSING_JOB_ID',
      } as ReceiverResponse);
      return;
    }
    
    if (!article.title || !article.slug || !article.bodyHtml) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: title, slug, bodyHtml',
        errorCode: 'MISSING_REQUIRED_FIELDS',
      } as ReceiverResponse);
      return;
    }
    
    logger.info('Receiving article (Platinum)', {
      jobId: article.jobId,
      title: article.title,
      slug: article.slug,
      mediaCount: article.media?.length || 0,
    });
    
    // ── Download / decode all media first ──────────────────────────────────
    // The media-downloader handles both base64 payloads (Platinum, no hotlink)
    // and standard URL downloads (legacy compatibility).
    let mediaMap = new Map();
    if (article.media && article.media.length > 0) {
      mediaMap = await downloadMultipleMedia(article.media);
      logger.info('Media processed', { 
        jobId: article.jobId,
        requested: article.media.length,
        saved: mediaMap.size,
      });
    }
    
    // ── Platinum upsert: Cheerio hydration + JSON record + HTML page ────────
    // This single call fixes the "split brain" ghost article problem.
    // It rewrites image URLs in bodyHtml, writes the structured JSON data
    // record for the CMS, updates index.json, and writes the HTML page.
    const storage = getLocalStorage();
    const result = await storage.upsertArticleByTitle(article, mediaMap);
    
    const mediaUrls: Record<string, string> = {};
    mediaMap.forEach((downloadResult, id) => {
      mediaUrls[id] = downloadResult.publicUrl;
    });
    
    const duration = Date.now() - startTime;
    logger.info('Article published (Platinum)', {
      jobId: article.jobId,
      slug: result.slug,
      pageUrl: result.pageUrl,
      indexUpdated: result.indexUpdated,
      duration,
    });
    
    res.status(200).json({
      success: true,
      data: {
        slug: result.slug,
        pageUrl: result.pageUrl,
        dataFilePath: result.dataFilePath,
        indexUpdated: result.indexUpdated,
        mediaUrls,
      },
    } as ReceiverResponse);
    
    // ── Fire-and-forget: notify the engine of success ───────────────────────
    sendCallback(createSuccessCallback(
      article.jobId,
      result.pageUrl,
      result.slug,
      mediaUrls
    )).catch(err => {
      logger.error('Failed to send success callback', { 
        jobId: article.jobId, 
        error: err.message 
      });
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    const jobId = req.body?.jobId;
    
    logger.error('Article processing failed', {
      jobId,
      error: errorMessage,
      stack: errorStack,
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to create article',
      errorCode: 'PROCESSING_ERROR',
      // Include the real error in details for diagnostics
      details: errorMessage,
    } as ReceiverResponse);
    
    if (jobId) {
      sendCallback(createFailureCallback(
        jobId,
        `Failed to create article: ${errorMessage}`,
        'PROCESSING_ERROR'
      )).catch(err => {
        logger.error('Failed to send failure callback', { 
          jobId, 
          error: err.message 
        });
      });
    }
  }
});

export default router;
