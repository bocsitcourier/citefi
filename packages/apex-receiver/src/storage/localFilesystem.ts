import fs from 'fs/promises';
import path from 'path';
import { load as cheerioLoad } from 'cheerio';
import { StorageAdapter, StorageResult, UpsertResult } from './index';
import { getConfig } from '../config';
import { logger } from '../utils/logger';
import type { ArticlePayload } from '../types/payloads';
import type { DownloadResult } from '../services/media-downloader';

// ─── Article index entry shape (kept lean for fast listing pages) ─────────────
interface ArticleIndexEntry {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  heroImageUrl?: string;
  status: string;
  publishedAt: string;
  category?: string;
}

// ─── Full article data record (powers the article view page) ─────────────────
interface ArticleRecord extends ArticleIndexEntry {
  id: string;
  keywords: string[];
  author?: ArticlePayload['author'];
  location?: ArticlePayload['location'];
  contentHtml: string;
  jsonLd?: Record<string, unknown>;
  openGraph?: ArticlePayload['openGraph'];
  hashtags?: string[];
  canonicalUrl?: string;
  updatedAt: string;
}

export class LocalFilesystemAdapter implements StorageAdapter {
  private get basePath(): string {
    return getConfig().storagePath;
  }

  private get baseUrl(): string {
    return getConfig().baseUrl;
  }

  // Directories for the Platinum data layer
  private get dataDir(): string {
    return path.join(this.basePath, '..', 'data', 'articles');
  }

  private get pagesDir(): string {
    return path.join(this.basePath, '..', 'pages');
  }

  async saveFile(relativePath: string, content: Buffer): Promise<string> {
    const fullPath = path.join(this.basePath, relativePath);
    const dir = path.dirname(fullPath);
    
    await this.ensureDirectory(dir);
    await fs.writeFile(fullPath, content);
    
    logger.debug('File saved', { path: fullPath, size: content.length });
    
    return fullPath;
  }

  getFileUrl(relativePath: string): string {
    return `${this.baseUrl}/uploads/${relativePath}`;
  }

  async deleteFile(relativePath: string): Promise<void> {
    const fullPath = path.join(this.basePath, relativePath);
    try {
      await fs.unlink(fullPath);
      logger.debug('File deleted', { path: fullPath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async fileExists(relativePath: string): Promise<boolean> {
    const fullPath = path.join(this.basePath, relativePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async ensureDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async downloadAndStore(
    sourceUrl: string,
    targetPath: string
  ): Promise<StorageResult> {
    logger.info('Downloading file', { sourceUrl, targetPath });
    
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    const localPath = await this.saveFile(targetPath, buffer);
    const publicUrl = this.getFileUrl(targetPath);
    
    logger.info('File downloaded and stored', { 
      sourceUrl, 
      localPath, 
      publicUrl,
      size: buffer.length 
    });
    
    return { localPath, publicUrl };
  }

  // ─── PLATINUM: Unified article upsert ────────────────────────────────────────
  // Fixes the "split brain" ghost article problem by:
  //   1. Using Cheerio to surgically rewrite all <img> src values in bodyHtml
  //      to the locally-saved public URLs (no hotlinking, no 404s).
  //   2. Writing a structured JSON data file that the website CMS reads for
  //      both the card grid (listing) and the article page (body + images).
  //   3. Maintaining a master index.json that listing pages can iterate.
  //   4. Writing a standalone HTML page for direct URL access.
  // ─────────────────────────────────────────────────────────────────────────────
  async upsertArticleByTitle(
    article: ArticlePayload,
    mediaMap: Map<string, DownloadResult>
  ): Promise<UpsertResult> {
    const slug = sanitizeSlug(article.slug);
    const publishedAt = new Date().toISOString();

    logger.info('Upserting article (Platinum)', {
      slug,
      title: article.title,
      mediaMapSize: mediaMap.size,
    });

    // ── Step 1: Cheerio image hydration ─────────────────────────────────────
    // Parse the raw bodyHtml and surgically replace every <img src> that
    // matches a downloaded media ID with its local public URL.
    let rewrittenCount = 0;
    let bodyHtml = sanitizeHtml(article.bodyHtml);

    try {
      const $ = cheerioLoad(bodyHtml);

      $('img').each((_, el) => {
        const src = $(el).attr('src');
        if (!src) return;

        // Exact key match (most common — mediaMap key === img src value)
        const exactMatch = mediaMap.get(src);
        if (exactMatch) {
          $(el).attr('src', exactMatch.publicUrl);
          rewrittenCount++;
          return;
        }

        // Partial match: the src might contain the ID as a substring or vice versa.
        // (Handles cases where the engine adds a query-string or the src is a full
        //  absolute URL while the mediaMap key is the relative path.)
        for (const [id, result] of mediaMap.entries()) {
          if (id === 'hero') continue; // hero handled separately below
          if (src.includes(id) || id.includes(src)) {
            $(el).attr('src', result.publicUrl);
            rewrittenCount++;
            break;
          }
        }
      });

      // Extract the <body> inner HTML after Cheerio wraps it
      bodyHtml = $('body').html() || bodyHtml;
    } catch (cheerioErr) {
      // Non-fatal: fall back to the raw bodyHtml without rewriting
      logger.warn('Cheerio image rewrite failed — using raw bodyHtml', {
        slug,
        error: (cheerioErr as Error).message,
      });
    }

    logger.info('Cheerio image hydration complete', { slug, rewrittenCount });

    // ── Step 2: Resolve hero image URL ──────────────────────────────────────
    // Prefer the locally-downloaded copy; fall back to the original engine URL.
    const heroDownload = mediaMap.get('hero');
    const heroImageUrl = heroDownload
      ? heroDownload.publicUrl
      : (article.heroImage?.url || undefined);

    // ── Step 3: Write the unified JSON data record ───────────────────────────
    // This is what the website CMS reads. It contains BOTH the metadata
    // (for the card grid) AND the hydrated contentHtml (for the article view).
    await this.ensureDirectory(this.dataDir);

    const record: ArticleRecord = {
      id: article.id,
      slug,
      title: article.title,
      metaTitle: article.metaTitle,
      metaDescription: article.metaDescription,
      keywords: article.keywords,
      status: article.status,
      category: article.category,
      author: article.author,
      location: article.location,
      heroImageUrl,
      contentHtml: bodyHtml,
      jsonLd: article.jsonLd,
      openGraph: {
        ...article.openGraph,
        // Upgrade openGraph.image to the local URL if we downloaded the hero
        ...(heroImageUrl ? { image: heroImageUrl } : {}),
      },
      hashtags: article.hashtags,
      canonicalUrl: article.canonicalUrl || `${this.baseUrl}/${slug}`,
      publishedAt,
      updatedAt: publishedAt,
    };

    const dataFilePath = path.join(this.dataDir, `${slug}.json`);
    await fs.writeFile(dataFilePath, JSON.stringify(record, null, 2), 'utf-8');
    logger.info('Article data record written', { dataFilePath });

    // ── Step 4: Maintain master index.json ──────────────────────────────────
    // This powers listing pages / card grids without reading every .json file.
    const indexPath = path.join(this.dataDir, 'index.json');
    let indexUpdated = false;
    try {
      let index: ArticleIndexEntry[] = [];
      try {
        const existing = await fs.readFile(indexPath, 'utf-8');
        index = JSON.parse(existing) as ArticleIndexEntry[];
      } catch {
        // First run — start with an empty index
      }

      // Replace existing entry for this slug or prepend a new one
      const existingIdx = index.findIndex(e => e.slug === slug);
      const indexEntry: ArticleIndexEntry = {
        slug,
        title: article.title,
        metaTitle: article.metaTitle,
        metaDescription: article.metaDescription,
        heroImageUrl,
        status: article.status,
        publishedAt,
        category: article.category,
      };

      if (existingIdx >= 0) {
        index[existingIdx] = indexEntry;
      } else {
        index.unshift(indexEntry); // newest first
      }

      await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
      indexUpdated = true;
      logger.info('Article index updated', { slug, total: index.length });
    } catch (indexErr) {
      logger.warn('Failed to update article index — article data record still written', {
        slug,
        error: (indexErr as Error).message,
      });
    }

    // ── Step 5: Write standalone HTML page ──────────────────────────────────
    // Provides a direct-access URL for the article even when the CMS is not
    // configured. The JSON record is the authoritative source; this is a bonus.
    const pageUrl = `${this.baseUrl}/${slug}`;
    try {
      await this.ensureDirectory(this.pagesDir);
      const pageHtml = generateFullPage(article, bodyHtml, heroImageUrl || null, this.baseUrl, slug);
      const htmlFilePath = path.join(this.pagesDir, `${slug}.html`);
      await fs.writeFile(htmlFilePath, pageHtml, 'utf-8');
      logger.info('Standalone HTML page written', { htmlFilePath, pageUrl });
    } catch (htmlErr) {
      // Non-fatal — the JSON record is what matters for modern CMS sites
      logger.warn('Failed to write standalone HTML page — JSON record still saved', {
        slug,
        error: (htmlErr as Error).message,
      });
    }

    return { slug, pageUrl, dataFilePath, indexUpdated };
  }
}

// ─── HTML Helpers ─────────────────────────────────────────────────────────────

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '');
}

function sanitizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, c => map[c] ?? '');
}

function generateFullPage(
  article: ArticlePayload,
  bodyHtml: string,
  heroImageUrl: string | null,
  baseUrl: string,
  slug: string
): string {
  const canonicalUrl = article.canonicalUrl || `${baseUrl}/${slug}`;
  const jsonLd = article.jsonLd || {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.metaDescription,
    keywords: article.keywords.join(', '),
    url: canonicalUrl,
    datePublished: new Date().toISOString(),
    dateModified: new Date().toISOString(),
    ...(heroImageUrl ? { image: { '@type': 'ImageObject', url: heroImageUrl } } : {}),
    ...(article.author ? { author: { '@type': 'Person', name: article.author.name } } : {}),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(article.metaTitle)}</title>
  <meta name="description" content="${escapeHtml(article.metaDescription)}">
  <meta name="keywords" content="${article.keywords.map(k => escapeHtml(k)).join(', ')}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:type" content="${article.openGraph?.type || 'article'}">
  <meta property="og:title" content="${escapeHtml(article.openGraph?.title || article.metaTitle)}">
  <meta property="og:description" content="${escapeHtml(article.openGraph?.description || article.metaDescription)}">
  <meta property="og:url" content="${canonicalUrl}">
  ${heroImageUrl ? `<meta property="og:image" content="${heroImageUrl}">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(article.metaTitle)}">
  <meta name="twitter:description" content="${escapeHtml(article.metaDescription)}">
  ${heroImageUrl ? `<meta name="twitter:image" content="${heroImageUrl}">` : ''}
  ${article.author ? `<meta name="author" content="${escapeHtml(article.author.name)}">` : ''}
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;line-height:1.6;max-width:800px;margin:0 auto;padding:20px}
    h1{font-size:2.5rem;margin-bottom:.5rem}
    .meta{color:#666;margin-bottom:2rem}
    .hero-image{width:100%;max-height:400px;object-fit:cover;border-radius:8px;margin-bottom:2rem}
    .content img{max-width:100%;height:auto}
    .hashtags{margin-top:2rem;color:#0066cc}
    a{color:#0066cc}
  </style>
</head>
<body>
  <article>
    <header>
      <h1>${escapeHtml(article.title)}</h1>
      <div class="meta">
        ${article.author ? `<span class="author">By ${escapeHtml(article.author.name)}</span>` : ''}
        ${article.location?.city ? ` | <span class="location">${escapeHtml(article.location.city)}${article.location.state ? `, ${escapeHtml(article.location.state)}` : ''}</span>` : ''}
      </div>
    </header>
    ${heroImageUrl ? `<img src="${heroImageUrl}" alt="${escapeHtml(article.heroImage?.altText || article.title)}" class="hero-image">` : ''}
    ${article.excerpt ? `<p class="excerpt"><strong>${escapeHtml(article.excerpt)}</strong></p>` : ''}
    <div class="content">
      ${bodyHtml}
    </div>
    ${article.hashtags && article.hashtags.length > 0 ? `<div class="hashtags">${article.hashtags.map(t => `<span class="hashtag">${escapeHtml(t)}</span>`).join(' ')}</div>` : ''}
  </article>
</body>
</html>`;
}

// ─── Singleton helpers ────────────────────────────────────────────────────────

let _localStorage: LocalFilesystemAdapter | null = null;

export function getLocalStorage(): LocalFilesystemAdapter {
  if (!_localStorage) {
    _localStorage = new LocalFilesystemAdapter();
  }
  return _localStorage;
}

export const localStorage = new Proxy({} as LocalFilesystemAdapter, {
  get(_target, prop) {
    return (getLocalStorage() as any)[prop];
  },
});
