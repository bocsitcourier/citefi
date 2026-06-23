import { db } from "./db";
import { sitePages, siteCrawlJobs } from "@/shared/schema";
import { eq, and, ne } from "drizzle-orm";
import { validateExternalUrl } from "./url-validation";

const MAX_FETCH_TIMEOUT = 15000;
const MAX_CONTENT_LENGTH = 500000;

interface CrawledPage {
  url: string;
  path: string;
  title: string;
  metaDescription: string;
  headings: string[];
  contentSummary: string;
  topics: string[];
  pageType: string;
  wordCount: number;
}

function extractDomain(url: string): string {
  const parsed = new URL(url);
  return parsed.hostname.replace(/^www\./, "");
}

function normalizePath(url: string, baseUrl: string): string {
  try {
    const parsed = new URL(url, baseUrl);
    return parsed.pathname.replace(/\/$/, "") || "/";
  } catch {
    return url;
  }
}

function isInternalLink(href: string, domain: string): boolean {
  try {
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
      return false;
    }
    if (href.startsWith("/") && !href.startsWith("//")) {
      return true;
    }
    const parsed = new URL(href);
    const linkDomain = parsed.hostname.replace(/^www\./, "");
    return linkDomain === domain;
  } catch {
    return false;
  }
}

function extractTextContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) return titleMatch[1]!.trim().substring(0, 500);

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) return h1Match[1]!.replace(/<[^>]*>/g, "").trim().substring(0, 500);

  return "";
}

function extractMetaDescription(html: string): string {
  const match = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i) ||
    html.match(/<meta\s+content=["']([\s\S]*?)["']\s+name=["']description["']/i);
  return match ? match[1]!.trim().substring(0, 500) : "";
}

function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  const regex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let match;
  while ((match = regex.exec(html)) !== null && headings.length < 20) {
    const text = match[1]!.replace(/<[^>]*>/g, "").trim();
    if (text.length > 2 && text.length < 200) {
      headings.push(text);
    }
  }
  return headings;
}

function extractInternalLinks(html: string, baseUrl: string, domain: string): string[] {
  const links = new Set<string>();
  const regex = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1]!.trim();
    if (isInternalLink(href, domain)) {
      try {
        const fullUrl = new URL(href, baseUrl).href.split("?")[0]!.split("#")[0]!;
        const path = new URL(fullUrl).pathname;
        if (!path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|pdf|zip|mp4|mp3|woff|woff2|ttf|eot)$/i)) {
          links.add(fullUrl);
        }
      } catch {}
    }
  }
  return Array.from(links);
}

function classifyPageType(path: string, title: string, content: string): string {
  const lowerPath = path.toLowerCase();
  const lowerTitle = title.toLowerCase();
  if (lowerPath === "/" || lowerPath === "") return "homepage";
  if (lowerPath.match(/\/(blog|news|article|post)/)) return "blog";
  if (lowerPath.match(/\/(service|what-we-do|our-work|capabilities)/)) return "service";
  if (lowerPath.match(/\/(product|shop|store|catalog)/)) return "product";
  if (lowerPath.match(/\/(about|team|staff|our-story)/)) return "about";
  if (lowerPath.match(/\/(contact|get-in-touch|reach-us)/)) return "contact";
  if (lowerPath.match(/\/(faq|help|support|knowledge)/)) return "faq";
  if (lowerPath.match(/\/(pricing|plans|packages)/)) return "pricing";
  if (lowerPath.match(/\/(case-study|portfolio|testimonial|review)/)) return "case_study";
  if (lowerPath.match(/\/(location|area|city|region)/)) return "location";
  if (lowerTitle.match(/service|solution|offer/i)) return "service";
  if (lowerTitle.match(/product|feature/i)) return "product";
  return "page";
}

function generateContentSummary(text: string, title: string, headings: string[]): string {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const topSentences = sentences.slice(0, 5).map(s => s.trim()).join(". ");
  const summary = topSentences.substring(0, 500);
  return summary || title;
}

function extractTopics(title: string, headings: string[], text: string, metaDesc: string): string[] {
  const topics = new Set<string>();
  if (title) topics.add(title.toLowerCase().substring(0, 100));
  headings.slice(0, 5).forEach(h => topics.add(h.toLowerCase().substring(0, 100)));
  if (metaDesc) {
    const words = metaDesc.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const phrases: string[] = [];
    for (let i = 0; i < words.length - 2; i++) {
      phrases.push(words.slice(i, i + 3).join(" "));
    }
    phrases.slice(0, 5).forEach(p => topics.add(p));
  }
  return Array.from(topics).slice(0, 15);
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    validateExternalUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAX_FETCH_TIMEOUT);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "CitefiBot/1.0 (SEO Content Indexer)",
        "Accept": "text/html",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;

    const text = await response.text();
    if (text.length > MAX_CONTENT_LENGTH) return text.substring(0, MAX_CONTENT_LENGTH);
    return text;
  } catch (error) {
    console.log(`  Skipping ${url}: ${error instanceof Error ? error.message : "fetch failed"}`);
    return null;
  }
}

function parsePage(html: string, url: string): CrawledPage {
  const parsed = new URL(url);
  const title = extractTitle(html);
  const metaDescription = extractMetaDescription(html);
  const headings = extractHeadings(html);
  const textContent = extractTextContent(html);
  const wordCount = textContent.split(/\s+/).length;
  const contentSummary = generateContentSummary(textContent, title, headings);
  const topics = extractTopics(title, headings, textContent, metaDescription);
  const pageType = classifyPageType(parsed.pathname, title, textContent);

  return {
    url,
    path: parsed.pathname,
    title,
    metaDescription,
    headings,
    contentSummary,
    topics,
    pageType,
    wordCount,
  };
}

export async function crawlWebsite(
  crawlJobId: number,
  baseUrl: string,
  teamId: number,
  maxPages: number = 50,
  maxDepth: number = 3
): Promise<{ pagesIndexed: number; errors: string[] }> {
  const domain = extractDomain(baseUrl);
  const errors: string[] = [];
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: baseUrl, depth: 0 }];
  let pagesIndexed = 0;

  console.log(`\n🕷️ Starting site crawl: ${baseUrl} (max ${maxPages} pages, depth ${maxDepth})`);

  await db.update(siteCrawlJobs)
    .set({ status: "RUNNING", startedAt: new Date() })
    .where(eq(siteCrawlJobs.id, crawlJobId));

  // GAP 1 FIX: Do NOT delete existing pages at the start of a crawl.
  // Old pages remain available and queryable while the new crawl runs.
  // We tag new pages with crawlJobId, then atomically remove old pages only
  // after the new crawl completes successfully. This eliminates the "dead zone"
  // where articles generated mid-crawl would fall back to single-URL mode.

  try {
    while (queue.length > 0 && pagesIndexed < maxPages) {
      const { url, depth } = queue.shift()!;

      const normalizedUrl = url.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
      if (visited.has(normalizedUrl)) continue;
      visited.add(normalizedUrl);

      console.log(`  📄 [${pagesIndexed + 1}/${maxPages}] Crawling: ${normalizedUrl} (depth ${depth})`);

      const html = await fetchPage(normalizedUrl);
      if (!html) {
        errors.push(`Failed to fetch: ${normalizedUrl}`);
        continue;
      }

      const page = parsePage(html, normalizedUrl);

      if (page.wordCount < 50 || !page.title) {
        console.log(`  Skipping thin page: ${normalizedUrl} (${page.wordCount} words)`);
        continue;
      }

      await db.insert(sitePages).values({
        teamId,
        domain,
        crawlJobId,
        url: normalizedUrl,
        path: page.path,
        title: page.title,
        metaDescription: page.metaDescription,
        headings: page.headings,
        contentSummary: page.contentSummary,
        topics: page.topics,
        pageType: page.pageType,
        wordCount: page.wordCount,
        lastCrawledAt: new Date(),
      });

      pagesIndexed++;

      await db.update(siteCrawlJobs)
        .set({ pagesFound: visited.size, pagesIndexed })
        .where(eq(siteCrawlJobs.id, crawlJobId));

      if (depth < maxDepth) {
        const links = extractInternalLinks(html, normalizedUrl, domain);
        for (const link of links) {
          const normalizedLink = link.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
          if (!visited.has(normalizedLink)) {
            queue.push({ url: normalizedLink, depth: depth + 1 });
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Atomic swap: now that new pages are all inserted, remove pages from previous crawls.
    // This is safe because new pages are already in the table and queryable.
    await db.delete(sitePages)
      .where(and(
        eq(sitePages.teamId, teamId),
        eq(sitePages.domain, domain),
        ne(sitePages.crawlJobId, crawlJobId)
      ));
    console.log(`🗑️ Removed stale pages from previous crawls for ${domain}`);

    await db.update(siteCrawlJobs)
      .set({
        status: "COMPLETED",
        pagesFound: visited.size,
        pagesIndexed,
        completedAt: new Date(),
      })
      .where(eq(siteCrawlJobs.id, crawlJobId));

    console.log(`✅ Crawl complete: ${pagesIndexed} pages indexed from ${domain}`);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown crawl error";
    errors.push(errorMsg);
    console.error(`❌ Crawl failed: ${errorMsg}`);

    // On failure: do NOT delete old pages — they remain available for article generation.
    // Partially crawled new pages (with this crawlJobId) are left in place and will be
    // cleaned up by the next successful crawl.
    await db.update(siteCrawlJobs)
      .set({
        status: "FAILED",
        errorMessage: errorMsg,
        pagesFound: visited.size,
        pagesIndexed,
        completedAt: new Date(),
      })
      .where(eq(siteCrawlJobs.id, crawlJobId));
  }

  return { pagesIndexed, errors };
}

export async function getTeamSitePages(teamId: number, domain?: string) {
  const conditions = [eq(sitePages.teamId, teamId), eq(sitePages.isActive, 1)];
  if (domain) conditions.push(eq(sitePages.domain, domain));
  return db.select().from(sitePages).where(and(...conditions));
}

// GAP 2 FIX: Extract root domain by stripping all subdomains.
// e.g. "blog.example.com" → "example.com", "www.sub.example.co.uk" → "example.co.uk"
function extractRootDomain(domain: string): string {
  const parts = domain.replace(/^www\./, "").split(".");
  // Keep last two segments (handles .com, .net, .org, etc.)
  // For ccTLDs like .co.uk keep last three
  const ccTLD = parts.length >= 3 && parts[parts.length - 2]!.length <= 3;
  return ccTLD ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
}

export async function matchTopicToPages(
  teamId: number,
  articleTopic: string,
  targetDomain: string,
  maxMatches: number = 10
): Promise<Array<{ url: string; title: string; contentSummary: string; relevanceScore: number }>> {
  // GAP 2 FIX: Try exact domain first, then fall back to root domain.
  // Handles cases where batch URL uses a subdomain (blog.example.com) but the
  // crawl was run on the root domain (example.com), or vice versa.
  let pages = await getTeamSitePages(teamId, targetDomain);

  if (pages.length === 0) {
    const rootDomain = extractRootDomain(targetDomain);
    if (rootDomain !== targetDomain) {
      console.log(`📎 No pages for "${targetDomain}" — trying root domain "${rootDomain}"`);
      pages = await getTeamSitePages(teamId, rootDomain);
    }
  }

  if (pages.length === 0) return [];

  const topicLower = articleTopic.toLowerCase();
  const topicWords = topicLower.split(/\s+/).filter(w => w.length > 3);

  const scored = pages.map(page => {
    let score = 0;
    const pageText = [
      page.title || "",
      page.metaDescription || "",
      page.contentSummary || "",
      ...(page.topics || []),
    ].join(" ").toLowerCase();

    for (const word of topicWords) {
      if (pageText.includes(word)) score += 2;
    }

    if (page.title && topicWords.some(w => (page.title || "").toLowerCase().includes(w))) score += 5;
    if (page.pageType === "service") score += 3;
    if (page.pageType === "product") score += 2;
    if (page.pageType === "blog") score += 1;
    if (page.pageType === "homepage") score += 1;

    const topicPhrases: string[] = [];
    for (let i = 0; i < topicWords.length - 1; i++) {
      topicPhrases.push(topicWords.slice(i, i + 2).join(" "));
    }
    for (const phrase of topicPhrases) {
      if (pageText.includes(phrase)) score += 4;
    }

    return {
      url: page.url,
      title: page.title || page.path,
      contentSummary: page.contentSummary || "",
      relevanceScore: score,
    };
  });

  return scored
    .filter(p => p.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxMatches);
}
