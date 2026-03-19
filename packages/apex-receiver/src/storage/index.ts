import type { ArticlePayload } from '../types/payloads';
import type { DownloadResult } from '../services/media-downloader';

export interface UpsertResult {
  slug: string;
  pageUrl: string;
  dataFilePath: string;
  indexUpdated: boolean;
}

export interface StorageAdapter {
  saveFile(path: string, content: Buffer): Promise<string>;
  getFileUrl(path: string): string;
  deleteFile(path: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  ensureDirectory(path: string): Promise<void>;
  /**
   * Platinum Storage: Unified article save that fixes the "split brain" problem.
   * Uses Cheerio to rewrite all image URLs in bodyHtml to locally-saved paths,
   * writes a structured JSON data record for the CMS card grid and article view,
   * maintains a master index.json for article listings, and writes the full HTML page.
   */
  upsertArticleByTitle(
    article: ArticlePayload,
    mediaMap: Map<string, DownloadResult>
  ): Promise<UpsertResult>;
}

export interface StorageResult {
  localPath: string;
  publicUrl: string;
}
