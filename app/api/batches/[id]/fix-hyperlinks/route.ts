import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { buildSlugMap, injectLinksWithIntent, buildFallbackTerms } from "@/lib/slug-map-injector";

/**
 * POST /api/batches/[id]/fix-hyperlinks
 * 
 * Programmatically applies stored hyperlinks and hashtags to articles that are
 * missing them in their final HTML. This is a fix for the December 2025 regression
 * where GPT-4 hyperlinking was unreliable.
 * 
 * The fix:
 * 1. Uses hyperlinks already stored in hyperlinked_keywords_json (from ChatGPT batched review)
 * 2. Programmatically applies them via regex (no API calls needed)
 * 3. Ensures hashtags are always appended to HTML
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const { id } = await params;
    const batchId = parseInt(id);

    if (isNaN(batchId)) {
      return NextResponse.json({ error: "Invalid batch ID" }, { status: 400 });
    }

    // Get batch to verify team ownership and get targetUrl
    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)));

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const targetUrl = batch.targetUrl || "#";

    // Get all completed articles in this batch
    const batchArticles = await db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.batchId, batchId),
          inArray(articles.articleStatus, ["COMPLETE", "GPT4_ENHANCED", "REVIEWED", "CHATGPT_REVIEWED"])
        )
      );

    if (batchArticles.length === 0) {
      return NextResponse.json(
        { message: "No completed articles found in this batch" },
        { status: 200 }
      );
    }

    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const results: Array<{ articleId: number; status: string; details: string }> = [];

    for (const article of batchArticles) {
      try {
        let finalHtml = article.finalHtmlContent || "";
        let modified = false;

        // CRITICAL FIX: Clean hyperlinks from JSON-LD schema first
        // The previous bug put hyperlinks INSIDE the schema's articleBody/description/keywords
        // which is wrong - schema should have plain text
        const originalHtml = finalHtml;
        finalHtml = cleanHyperlinksFromSchema(finalHtml);
        const schemaWasCleaned = finalHtml !== originalHtml;
        
        // Get the visible body (after the JSON-LD script) to check for hyperlinks
        const schemaEndPos = finalHtml.indexOf('</script>');
        const visibleBody = schemaEndPos > 0 ? finalHtml.substring(schemaEndPos) : finalHtml;
        
        // Check if hyperlinks are in the VISIBLE body (not just in schema)
        const storedHyperlinks = Array.isArray(article.hyperlinkedKeywordsJson)
          ? article.hyperlinkedKeywordsJson
          : [];
        const hasHyperlinksInBody = visibleBody.includes('class="text-primary hover:underline"');

        // Check if hashtags are stored but not applied
        const storedHashtags = Array.isArray(article.hashtagsJson)
          ? article.hashtagsJson
          : [];
        const hasHashtagsInHtml = finalHtml.includes('class="hashtag-link"') || finalHtml.includes('class="hashtags"');

        // Only skip if hyperlinks are in the VISIBLE body (not in schema)
        if (hasHyperlinksInBody && hasHashtagsInHtml) {
          skippedCount++;
          results.push({
            articleId: article.id,
            status: "skipped",
            details: "Hyperlinks and hashtags already present in visible body",
          });
          continue;
        }

        // Apply hyperlinks using the Global Slug Map engine — same path as generation pipeline.
        // Reads crawled sitePages for multi-URL internal linking; falls back to batch terms.
        if (!hasHyperlinksInBody && targetUrl && targetUrl !== "#" && targetUrl.match(/^https?:\/\//i)) {
          try {
            const batchParams = batch.generationParams as Record<string, any> | null;
            const fallbackTerms = buildFallbackTerms({
              coreTopic: batch.coreTopic,
              geographicFocus: batchParams?.geographicFocus,
              businessName: batch.businessName,
              geminiKeywords: [],
            });
            const { entries, pages } = await buildSlugMap(teamId, targetUrl, fallbackTerms);
            const injection = await injectLinksWithIntent(finalHtml, entries, pages, targetUrl, article.chosenTitle || `article ${article.id}`, fallbackTerms);
            if (injection.linksInjected > 0) {
              finalHtml = injection.html;
              modified = true;
              console.log(`🔗 fix-hyperlinks: applied ${injection.linksInjected} links to article ${article.id} (${injection.mode} mode)`);
            }
          } catch (hlErr) {
            console.warn(`⚠️ fix-hyperlinks: slug map error for article ${article.id}:`, hlErr instanceof Error ? hlErr.message : hlErr);
          }
        }

        // Apply hashtags if needed
        if (!hasHashtagsInHtml && storedHashtags.length > 0) {
          finalHtml = applyHashtagsToHtml(finalHtml, storedHashtags, targetUrl);
          modified = true;
        }

        // Also mark as modified if schema was cleaned (even if hyperlinks were already in body)
        if (schemaWasCleaned) {
          modified = true;
        }

        if (modified) {
          // Update the article
          await db
            .update(articles)
            .set({ finalHtmlContent: finalHtml })
            .where(eq(articles.id, article.id));

          fixedCount++;
          const actions = [];
          if (schemaWasCleaned) actions.push("cleaned schema");
          if (!hasHyperlinksInBody && targetUrl && targetUrl !== "#") actions.push("applied hyperlinks (DOM engine)");
          if (!hasHashtagsInHtml && storedHashtags.length > 0) actions.push(`applied ${storedHashtags.length} hashtags`);
          
          results.push({
            articleId: article.id,
            status: "fixed",
            details: actions.join(", ") || "Modified",
          });
        } else {
          skippedCount++;
          results.push({
            articleId: article.id,
            status: "skipped",
            details: "No stored data to apply",
          });
        }
      } catch (error) {
        errorCount++;
        results.push({
          articleId: article.id,
          status: "error",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        total: batchArticles.length,
        fixed: fixedCount,
        skipped: skippedCount,
        errors: errorCount,
      },
      results,
    });
  } catch (error) {
    console.error("Fix hyperlinks error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fix hyperlinks" },
      { status: 500 }
    );
  }
}

/**
 * Cleans hyperlinks from within the JSON-LD schema script block.
 * Schema fields like description, keywords, articleBody should be plain text.
 */
function cleanHyperlinksFromSchema(html: string): string {
  // Find the JSON-LD script block
  const scriptMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  
  if (!scriptMatch) {
    return html; // No schema found
  }
  
  let schemaContent = scriptMatch[1];
  
  // Remove hyperlinks from schema content, preserving just the anchor text
  // Match: <a href="..." ... class="text-primary hover:underline">text</a>
  schemaContent = schemaContent.replace(
    /<a[^>]*class="text-primary hover:underline"[^>]*>([^<]*)<\/a>/gi,
    '$1'
  );
  
  // Also clean any other hyperlinks that might be in the schema
  schemaContent = schemaContent.replace(
    /<a[^>]*>([^<]*)<\/a>/gi,
    '$1'
  );
  
  // Replace the old schema with the cleaned one.
  // CRITICAL: Use split/join (not String.replace) to avoid JS treating $ in JSON as special
  // replacement patterns (e.g. "$150/hour" → "$1" gets interpreted as capture group reference).
  return html.split(scriptMatch[0]).join(`<script type="application/ld+json">${schemaContent}</script>`);
}

/**
 * Programmatically applies hyperlinks to HTML content (visible body only, not schema)
 */
function applyHyperlinksToHtml(
  html: string,
  hyperlinks: Array<{ phrase?: string; anchorText?: string; url: string }>
): string {
  // CRITICAL: Only apply hyperlinks to the visible body AFTER the schema script
  const schemaEndMatch = html.match(/<\/script>/i);
  if (!schemaEndMatch) {
    // No schema, apply to entire HTML
    return applyHyperlinksToContent(html, hyperlinks);
  }
  
  const schemaEndPos = html.indexOf('</script>') + '</script>'.length;
  const schemaSection = html.substring(0, schemaEndPos);
  const visibleBody = html.substring(schemaEndPos);
  
  // Apply hyperlinks only to the visible body
  const linkedBody = applyHyperlinksToContent(visibleBody, hyperlinks);
  
  return schemaSection + linkedBody;
}

/**
 * Core hyperlink application logic
 */
function applyHyperlinksToContent(
  content: string,
  hyperlinks: Array<{ phrase?: string; anchorText?: string; url: string }>
): string {
  let result = content;

  // Protect headings from being hyperlinked
  const headingMap = new Map<string, string>();
  let headingIndex = 0;
  result = result.replace(/<h[123][^>]*>[\s\S]*?<\/h[123]>/gi, (match) => {
    const placeholder = `___HEADING_PLACEHOLDER_${headingIndex}___`;
    headingMap.set(placeholder, match);
    headingIndex++;
    return placeholder;
  });

  // Protect existing links
  const linkMap = new Map<string, string>();
  let linkIndex = 0;
  result = result.replace(/<a[^>]*>[\s\S]*?<\/a>/gi, (match) => {
    const placeholder = `___LINK_PLACEHOLDER_${linkIndex}___`;
    linkMap.set(placeholder, match);
    linkIndex++;
    return placeholder;
  });

  // Apply up to 7 hyperlinks (GEO best practice)
  const linksToApply = hyperlinks.slice(0, 7);
  let appliedCount = 0;

  for (const link of linksToApply) {
    const phrase = link.anchorText || link.phrase;
    const url = link.url;

    if (!phrase || !url) continue;

    // Escape special regex characters
    const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Phase 1: exact match
    const regex = new RegExp(`\\b(${escapedPhrase})\\b`, "i");
    // Phase 2: punctuation-tolerant fallback (Boston MA → Boston, MA / Boston-MA)
    const tolerantPattern = escapedPhrase.replace(/\\ /g, "[\\s,\\-\\.]+");
    const tolerantRegex = new RegExp(`\\b(${tolerantPattern})\\b`, "i");

    const exactMatch = result.match(regex);
    const match = exactMatch || result.match(tolerantRegex);

    if (match) {
      const usedRegex = exactMatch ? regex : tolerantRegex;
      const linkHtml = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">${match[0]}</a>`;
      // CRITICAL: use replacer function to avoid $ in linkHtml being treated as special pattern
      result = result.replace(usedRegex, () => linkHtml);
      appliedCount++;
    }
  }

  // Restore protected content — use split/join to avoid $ in href/text being
  // interpreted as special replacement patterns ($& $1 $' etc.)
  for (const [placeholder, originalLink] of linkMap.entries()) {
    result = result.split(placeholder).join(originalLink);
  }

  for (const [placeholder, originalHeading] of headingMap.entries()) {
    result = result.split(placeholder).join(originalHeading);
  }

  console.log(`Applied ${appliedCount}/${linksToApply.length} hyperlinks to content`);
  
  return result;
}

/**
 * Programmatically appends hashtags section to HTML content
 */
function applyHashtagsToHtml(html: string, hashtags: string[], targetUrl: string): string {
  const hashtagLinks = hashtags
    .map(
      (tag) =>
        `<a href="${targetUrl}" target="_blank" rel="noopener noreferrer" class="hashtag-link">${tag}</a>`
    )
    .join(" ");

  const hashtagSection = `\n<div class="hashtags" style="margin-top: 2em; padding-top: 1em; border-top: 1px solid #eee;">\n  ${hashtagLinks}\n</div>`;

  // Insert before closing </article> tag
  if (html.includes("</article>")) {
    return html.replace("</article>", `${hashtagSection}\n</article>`);
  }

  // Append to end if no </article> tag
  return html + hashtagSection;
}
