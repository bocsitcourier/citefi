import { createHash } from 'node:crypto';

export const REVIEWED_MEDIA_MAX_BYTES = 32 * 1024 * 1024;
// All downloads complete before responding, within the sender's 30s timeout.
export const REVIEWED_MEDIA_DOWNLOAD_TIMEOUT_MS = 20_000;

export function reviewedMediaDigest(sourceUrl: string): string | undefined {
  if (!sourceUrl) return undefined; // Legacy base64-only payloads need no URL.
  let url: URL;
  try { url = new URL(sourceUrl); }
  catch {
    if (sourceUrl.includes('/api/publishing/review-media')) throw new Error('Invalid version-pinned media reference');
    return undefined;
  }
  if (url.pathname !== '/api/publishing/review-media') return undefined;
  const match = (url.searchParams.get('key') || '').match(/^private\/publishing-reviewed\/[1-9]\d*\/([a-f0-9]{64})\.[a-z0-9]+$/);
  if (url.protocol !== 'https:' || url.username || url.password || !match) throw new Error('Invalid version-pinned media reference');
  return match[1];
}

export function verifyReviewedMedia(bytes: Buffer, expectedDigest?: string): void {
  if (!expectedDigest) return;
  if (bytes.length > REVIEWED_MEDIA_MAX_BYTES) throw new Error('Reviewed media exceeds receiver byte limit');
  if (createHash('sha256').update(bytes).digest('hex') !== expectedDigest) throw new Error('Reviewed media digest mismatch');
}
