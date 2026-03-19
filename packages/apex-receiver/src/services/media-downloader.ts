import path from 'path';
import { localStorage } from '../storage/localFilesystem';
import { MediaPayload } from '../types/payloads';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';

export interface DownloadResult {
  id: string;
  localPath: string;
  publicUrl: string;
  filename: string;
}

export async function downloadMedia(media: MediaPayload): Promise<DownloadResult> {
  const uniqueId = nanoid(8);
  const ext = path.extname(media.filename) || getExtensionFromMimeType(media.mimeType);
  const filename = `${path.basename(media.filename, ext)}-${uniqueId}${ext}`;
  
  let targetDir: string;
  switch (media.type) {
    case 'image':
      targetDir = 'images';
      break;
    case 'video':
      targetDir = 'videos';
      break;
    case 'audio':
      targetDir = 'audio';
      break;
    default:
      targetDir = 'misc';
  }
  
  const targetPath = path.join(targetDir, filename);

  // ── Platinum: base64 path — no network download needed ────────────────────
  // When the sender provides base64Data, decode and save directly.
  // This eliminates hotlinking and network dependency on the engine server.
  if (media.base64Data) {
    logger.info('Saving media from base64', {
      id: media.id,
      type: media.type,
      filename,
    });

    const base64Clean = media.base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Clean, 'base64');
    const localPath = await localStorage.saveFile(targetPath, buffer);
    const publicUrl = localStorage.getFileUrl(targetPath);

    logger.info('Media saved from base64', { id: media.id, localPath, publicUrl, size: buffer.length });

    return { id: media.id, localPath, publicUrl, filename };
  }

  // ── Standard path: download from sourceUrl ────────────────────────────────
  logger.info('Downloading media', { 
    id: media.id, 
    type: media.type, 
    sourceUrl: media.sourceUrl,
    targetPath 
  });
  
  const result = await localStorage.downloadAndStore(media.sourceUrl, targetPath);
  
  return {
    id: media.id,
    localPath: result.localPath,
    publicUrl: result.publicUrl,
    filename,
  };
}

export async function downloadMultipleMedia(
  mediaList: MediaPayload[]
): Promise<Map<string, DownloadResult>> {
  const results = new Map<string, DownloadResult>();
  
  const downloads = await Promise.allSettled(
    mediaList.map(media => downloadMedia(media))
  );
  
  downloads.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      results.set(mediaList[index].id, result.value);
    } else {
      logger.error('Failed to download media', {
        id: mediaList[index].id,
        error: result.reason?.message,
      });
    }
  });
  
  return results;
}

function getExtensionFromMimeType(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/aac': '.aac',
  };
  
  return mimeMap[mimeType] || '';
}
