import { Router, Request, Response } from 'express';
import { MediaPayload, ReceiverResponse } from '../types/payloads';
import { downloadMedia, DownloadResult } from '../services/media-downloader';
import { logger } from '../utils/logger';

const router = Router();

interface MediaRequest extends MediaPayload {
  jobId?: string;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const media = req.body as MediaRequest;
    
    if (!media.id || !media.sourceUrl || !media.type || !media.filename) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: id, sourceUrl, type, filename',
        errorCode: 'MISSING_REQUIRED_FIELDS',
      } as ReceiverResponse);
      return;
    }
    
    logger.info('Receiving media', {
      id: media.id,
      type: media.type,
      filename: media.filename,
      jobId: media.jobId,
    });
    
    const result: DownloadResult = await downloadMedia(media);
    
    logger.info('Media stored', {
      id: media.id,
      publicUrl: result.publicUrl,
      localPath: result.localPath,
    });
    
    res.status(200).json({
      success: true,
      data: {
        id: result.id,
        publicUrl: result.publicUrl,
        filename: result.filename,
      },
    } as ReceiverResponse);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('Media processing failed', {
      id: req.body?.id,
      error: errorMessage,
    });
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      errorCode: 'MEDIA_PROCESSING_ERROR',
    } as ReceiverResponse);
  }
});

router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { media, jobId } = req.body as { media: MediaPayload[]; jobId?: string };
    
    if (!Array.isArray(media) || media.length === 0) {
      res.status(400).json({
        success: false,
        error: 'media must be a non-empty array',
        errorCode: 'INVALID_MEDIA_ARRAY',
      } as ReceiverResponse);
      return;
    }
    
    logger.info('Receiving media batch', {
      count: media.length,
      jobId,
    });
    
    const results: DownloadResult[] = [];
    const errors: Array<{ id: string; error: string }> = [];
    
    await Promise.all(
      media.map(async (item) => {
        try {
          const result = await downloadMedia(item);
          results.push(result);
        } catch (error) {
          errors.push({
            id: item.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })
    );
    
    const mediaUrls: Record<string, string> = {};
    results.forEach(result => {
      mediaUrls[result.id] = result.publicUrl;
    });
    
    logger.info('Media batch processed', {
      successful: results.length,
      failed: errors.length,
      jobId,
    });
    
    res.status(200).json({
      success: errors.length === 0,
      data: {
        mediaUrls,
        errors: errors.length > 0 ? errors : undefined,
      },
    } as ReceiverResponse);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('Media batch processing failed', {
      error: errorMessage,
    });
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      errorCode: 'BATCH_PROCESSING_ERROR',
    } as ReceiverResponse);
  }
});

export default router;
