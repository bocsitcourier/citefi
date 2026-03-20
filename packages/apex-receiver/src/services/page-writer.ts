import fs from 'fs/promises';
import path from 'path';
import { ArticlePayload } from '../types/payloads';
import { getConfig } from '../config';
import { logger } from '../utils/logger';
import { DownloadResult } from './media-downloader';

export interface PageWriteResult {
  slug: string;
  filePath: string;
  pageUrl: string;
}

function sanitizeHtml(html: string): string {
  let sanitized = html;
  
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  sanitized = sanitized.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
  
  sanitized = sanitized.replace(/javascript\s*:/gi, '');
  
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  sanitized = sanitized.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  sanitized = sanitized.replace(/<embed\b[^>]*\/?>/gi, '');
  
  return sanitized;
}

export async function writeArticlePage(
  article: ArticlePayload,
  mediaMap: Map<string, DownloadResult>
): Promise<PageWriteResult> {
  const slug = sanitizeSlug(article.slug);
  const pagesDir = path.join(getConfig().storagePath, '..', 'pages');
  const filePath = path.join(pagesDir, `${slug}.html`);
  
  await fs.mkdir(pagesDir, { recursive: true });
  
  let bodyHtml = sanitizeHtml(article.bodyHtml);
  
  mediaMap.forEach((result, originalId) => {
    bodyHtml = bodyHtml.replace(
      new RegExp(escapeRegExp(originalId), 'g'),
      result.publicUrl
    );
  });
  
  const heroImageUrl = article.heroImage 
    ? mediaMap.get(article.heroImage.id)?.publicUrl || article.heroImage.url
    : null;
  
  const pageHtml = generateFullPage(article, bodyHtml, heroImageUrl);
  
  await fs.writeFile(filePath, pageHtml, 'utf-8');
  
  const pageUrl = `${getConfig().baseUrl}/${slug}`;
  
  logger.info('Page written', { slug, filePath, pageUrl });
  
  return { slug, filePath, pageUrl };
}

function generateFullPage(
  article: ArticlePayload,
  bodyHtml: string,
  heroImageUrl: string | null
): string {
  const jsonLd = generateJsonLd(article, heroImageUrl);
  const openGraph = generateOpenGraphTags(article, heroImageUrl);
  const canonicalUrl = article.canonicalUrl || `${getConfig().baseUrl}/${sanitizeSlug(article.slug)}`;
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  
  <!-- SEO Meta Tags -->
  <title>${escapeHtml(article.metaTitle)}</title>
  <meta name="description" content="${escapeHtml(article.metaDescription)}">
  <meta name="keywords" content="${article.keywords.map(k => escapeHtml(k)).join(', ')}">
  <link rel="canonical" href="${canonicalUrl}">
  
  <!-- Open Graph Tags -->
  ${openGraph}
  
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(article.openGraph?.title || article.metaTitle)}">
  <meta name="twitter:description" content="${escapeHtml(article.openGraph?.description || article.metaDescription)}">
  ${heroImageUrl ? `<meta name="twitter:image" content="${heroImageUrl}">` : ''}
  
  <!-- Author & E-E-A-T Signals -->
  ${article.author ? `<meta name="author" content="${escapeHtml(article.author.name)}">` : ''}
  
  <!-- JSON-LD Structured Data -->
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>
  
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
    .meta { color: #666; margin-bottom: 2rem; }
    .hero-image { width: 100%; max-height: 400px; object-fit: cover; border-radius: 8px; margin-bottom: 2rem; }
    .content img { max-width: 100%; height: auto; }
    .hashtags { margin-top: 2rem; color: #0066cc; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <article>
    <header>
      <h1>${escapeHtml(article.title)}</h1>
      <div class="meta">
        ${article.author ? `<span class="author">By ${escapeHtml(article.author.name)}${article.author.credentials ? `, ${escapeHtml(article.author.credentials)}` : ''}</span>` : ''}
        ${article.location ? `<span class="location"> | ${formatLocation(article.location)}</span>` : ''}
      </div>
    </header>
    
    ${heroImageUrl ? `<img src="${heroImageUrl}" alt="${escapeHtml(article.heroImage?.altText || article.title)}" class="hero-image">` : ''}
    
    ${article.excerpt ? `<p class="excerpt"><strong>${escapeHtml(article.excerpt)}</strong></p>` : ''}
    
    <div class="content">
      ${bodyHtml}
    </div>
    
    ${article.hashtags && article.hashtags.length > 0 ? `
    <div class="hashtags">
      ${article.hashtags.map(tag => `<span class="hashtag">#${escapeHtml(tag)}</span>`).join(' ')}
    </div>
    ` : ''}
  </article>
</body>
</html>`;
}

function generateJsonLd(article: ArticlePayload, heroImageUrl: string | null): Record<string, unknown> {
  if (article.jsonLd) {
    return article.jsonLd;
  }
  
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.metaDescription,
    keywords: article.keywords.join(', '),
    url: article.canonicalUrl || `${getConfig().baseUrl}/${sanitizeSlug(article.slug)}`,
    datePublished: new Date().toISOString(),
    dateModified: new Date().toISOString(),
  };
  
  if (heroImageUrl) {
    jsonLd.image = {
      '@type': 'ImageObject',
      url: heroImageUrl,
      width: article.heroImage?.width || 1200,
      height: article.heroImage?.height || 630,
    };
  }
  
  if (article.author) {
    jsonLd.author = {
      '@type': 'Person',
      name: article.author.name,
      ...(article.author.url && { url: article.author.url }),
      ...(article.author.credentials && { 
        hasCredential: {
          '@type': 'EducationalOccupationalCredential',
          credentialCategory: article.author.credentials,
        }
      }),
    };
  }
  
  if (article.location) {
    jsonLd.locationCreated = {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        ...(article.location.city && { addressLocality: article.location.city }),
        ...(article.location.state && { addressRegion: article.location.state }),
        ...(article.location.country && { addressCountry: article.location.country }),
        ...(article.location.zipCode && { postalCode: article.location.zipCode }),
      },
    };
  }
  
  return jsonLd;
}

function generateOpenGraphTags(article: ArticlePayload, heroImageUrl: string | null): string {
  const og = article.openGraph || {};
  const tags: string[] = [];
  
  tags.push(`<meta property="og:type" content="${og.type || 'article'}">`);
  tags.push(`<meta property="og:title" content="${escapeHtml(og.title || article.metaTitle)}">`);
  tags.push(`<meta property="og:description" content="${escapeHtml(og.description || article.metaDescription)}">`);
  tags.push(`<meta property="og:url" content="${article.canonicalUrl || `${getConfig().baseUrl}/${sanitizeSlug(article.slug)}`}">`);
  
  if (heroImageUrl || og.image) {
    tags.push(`<meta property="og:image" content="${heroImageUrl || og.image}">`);
  }
  
  return tags.join('\n  ');
}

function sanitizeSlug(slug: string): string {
  return slug
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

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatLocation(location: ArticlePayload['location']): string {
  if (!location) return '';
  const parts = [
    location.neighborhood,
    location.city,
    location.state,
    location.zipCode,
  ].filter(Boolean);
  return parts.join(', ');
}
