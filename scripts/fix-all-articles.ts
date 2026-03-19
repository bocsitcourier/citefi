/**
 * BULK ARTICLE HEALER
 * ===================
 * Retroactively fixes every article that suffered from the "0-match" hyperlink bug.
 *
 * Uses the exact same lib/slug-map-injector.ts engine as the main generation
 * pipeline — guaranteeing consistency. Articles healed by this script will never
 * be broken again by a new generation run.
 *
 * USAGE (from Replit Shell):
 *
 *   Dry run (safe — no changes written):
 *     npx tsx scripts/fix-all-articles.ts
 *
 *   Live commit (writes healed HTML to database):
 *     npx tsx scripts/fix-all-articles.ts --commit
 *
 *   Target a specific batch:
 *     npx tsx scripts/fix-all-articles.ts --commit --batch=42
 *
 *   Target a specific team:
 *     npx tsx scripts/fix-all-articles.ts --commit --team=7
 *
 *   Limit to articles with 0 existing links only:
 *     npx tsx scripts/fix-all-articles.ts --commit --only-empty
 */

import "dotenv/config";
import { db } from "../lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq, inArray, and, isNotNull, asc } from "drizzle-orm";
import { buildSlugMap, injectLinksWithIntent, buildFallbackTerms } from "../lib/slug-map-injector";

// ---------------------------------------------------------------------------
// CLI FLAGS
// ---------------------------------------------------------------------------

const COMMIT     = process.argv.includes("--commit");
const ONLY_EMPTY = process.argv.includes("--only-empty");
const PAGE_SIZE  = 50; // Fetch 50 articles at a time to stay under Neon's 64MB HTTP cap

const batchFlag = process.argv.find((a) => a.startsWith("--batch="));
const teamFlag  = process.argv.find((a) => a.startsWith("--team="));

const filterBatchId = batchFlag ? parseInt(batchFlag.split("=")[1] ?? "") : undefined;
const filterTeamId  = teamFlag  ? parseInt(teamFlag.split("=")[1]  ?? "") : undefined;

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function healArticles() {
  console.log("=".repeat(70));
  console.log(`  BULK ARTICLE HEALER — ${COMMIT ? "🔴 LIVE COMMIT MODE" : "🟡 DRY RUN (safe)"}`);
  if (ONLY_EMPTY)     console.log("  Filter: articles with 0 existing hyperlinks only");
  if (filterBatchId)  console.log(`  Filter: batch ${filterBatchId} only`);
  if (filterTeamId)   console.log(`  Filter: team ${filterTeamId} only`);
  console.log("=".repeat(70));

  const HEALABLE_STATUSES = ["GPT4_ENHANCED", "COMPLETE", "PUBLISHED"];

  // ── Step 1: Fetch article IDs only (lightweight — no HTML body) ─────────
  // We paginate HTML fetches below to avoid Neon's 64MB response cap.
  const idRows = await db
    .select({ id: articles.id, batchId: articles.batchId, teamId: articles.teamId, chosenTitle: articles.chosenTitle })
    .from(articles)
    .where(
      and(
        inArray(articles.articleStatus, HEALABLE_STATUSES),
        isNotNull(articles.finalHtmlContent),
        filterBatchId ? eq(articles.batchId, filterBatchId) : undefined,
        filterTeamId  ? eq(articles.teamId,  filterTeamId)  : undefined,
      )
    )
    .orderBy(asc(articles.id));

  console.log(`\nFound ${idRows.length} articles to analyse (processing in pages of ${PAGE_SIZE}).\n`);

  let healed  = 0;
  let skipped = 0;
  let noLinks = 0;
  let errored = 0;

  // Batch cache: avoid re-fetching the same batch for every article
  const batchCache = new Map<number, typeof jobBatches.$inferSelect>();

  // ── Step 2: Process in pages of PAGE_SIZE ────────────────────────────────
  for (let offset = 0; offset < idRows.length; offset += PAGE_SIZE) {
    const page = idRows.slice(offset, offset + PAGE_SIZE);
    const pageIds = page.map((r) => r.id);

    // Fetch HTML for this page only
    const pageArticles = await db
      .select({ id: articles.id, finalHtmlContent: articles.finalHtmlContent, keywordsJson: articles.keywordsJson, batchId: articles.batchId, teamId: articles.teamId, chosenTitle: articles.chosenTitle })
      .from(articles)
      .where(inArray(articles.id, pageIds))
      .orderBy(asc(articles.id));

    for (const article of pageArticles) {
      const label = `[#${article.id}] "${(article.chosenTitle || "untitled").slice(0, 55)}"`;

      try {
        if (!article.finalHtmlContent) {
          console.log(`⏭  SKIP ${label} — no HTML content`);
          skipped++;
          continue;
        }

        const existingLinks = (article.finalHtmlContent.match(/<a\s[^>]*href=/gi) || []).length;

        if (ONLY_EMPTY && existingLinks > 0) {
          console.log(`⏭  SKIP ${label} — already has ${existingLinks} link(s)`);
          skipped++;
          continue;
        }

        // ── Fetch batch (cached) ─────────────────────────────────────────
        let batch = article.batchId ? batchCache.get(article.batchId) : undefined;
        if (!batch && article.batchId) {
          const [fetched] = await db
            .select()
            .from(jobBatches)
            .where(eq(jobBatches.id, article.batchId));
          if (fetched) {
            batchCache.set(article.batchId, fetched);
            batch = fetched;
          }
        }

        if (!batch) {
          console.warn(`⚠️  SKIP ${label} — batch not found (id=${article.batchId})`);
          skipped++;
          continue;
        }

        if (!batch.targetUrl || !batch.targetUrl.match(/^https?:\/\//i)) {
          console.warn(`⚠️  SKIP ${label} — batch has no valid targetUrl`);
          skipped++;
          continue;
        }

        if (!batch.teamId) {
          console.warn(`⚠️  SKIP ${label} — batch has no teamId`);
          skipped++;
          continue;
        }

        // SAFE JSONB extraction — geographicFocus lives inside generationParams
        const batchParams = (batch.generationParams as Record<string, any>) ?? {};

        const fallbackTerms = buildFallbackTerms({
          coreTopic: batch.coreTopic,
          geographicFocus: batchParams.geographicFocus,
          businessName: batch.businessName,
          geminiKeywords: Array.isArray(article.keywordsJson) ? (article.keywordsJson as string[]) : [],
        });

        // Build slug map (site-map or fallback)
        const { entries, pages } = await buildSlugMap(batch.teamId, batch.targetUrl, fallbackTerms);

        // Note: even when entries is empty, content-first extraction in injectLinksWithIntent
        // will pull real phrases from the article text using fallbackTerms as topic hints.
        if (entries.length === 0 && pages.length === 0 && fallbackTerms.length === 0) {
          console.log(`📭  NO MAP   ${label} — slug map empty (no crawl, no fallback terms)`);
          noLinks++;
          continue;
        }

        // Intent-driven injection: AI finds semantically relevant anchor phrases
        const injection = await injectLinksWithIntent(
          article.finalHtmlContent,
          entries,
          pages,
          batch.targetUrl,
          article.chosenTitle || `article ${article.id}`,
          fallbackTerms
        );

        if (injection.linksInjected === 0) {
          console.log(`📭  NO MATCH ${label} — ${entries.length} keywords, 0 matched [${injection.mode}]`);
          noLinks++;
          continue;
        }

        const linkedSample = injection.linkedKeywords.slice(0, 4).join(", ");

        if (COMMIT) {
          await db
            .update(articles)
            .set({ finalHtmlContent: injection.html })
            .where(eq(articles.id, article.id));
          console.log(
            `✅  FIXED    ${label}\n` +
            `             +${injection.linksInjected} links | was ${existingLinks} → now ${existingLinks + injection.linksInjected} | [${injection.mode}]\n` +
            `             Linked: ${linkedSample}${injection.linkedKeywords.length > 4 ? " …" : ""}`
          );
        } else {
          console.log(
            `🔍  WOULD FIX ${label}\n` +
            `             +${injection.linksInjected} links | currently has ${existingLinks} | [${injection.mode}]\n` +
            `             Would link: ${linkedSample}${injection.linkedKeywords.length > 4 ? " …" : ""}`
          );
        }
        healed++;

      } catch (err) {
        console.error(`❌  ERROR    ${label}:`, err instanceof Error ? err.message : err);
        errored++;
      }
    }

    console.log(`\n  — Page ${Math.floor(offset / PAGE_SIZE) + 1}/${Math.ceil(idRows.length / PAGE_SIZE)} complete —\n`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("=".repeat(70));
  console.log(`  SUMMARY`);
  console.log("=".repeat(70));
  console.log(`  Articles analysed : ${idRows.length}`);
  console.log(`  ${COMMIT ? "Fixed (committed)" : "Would fix"}     : ${healed}`);
  console.log(`  Skipped           : ${skipped}`);
  console.log(`  No keyword match  : ${noLinks}`);
  console.log(`  Errors            : ${errored}`);

  if (!COMMIT) {
    console.log("\n⚠️  DRY RUN — no changes saved.");
    console.log("   Re-run with --commit to apply:\n");
    console.log("   npx tsx scripts/fix-all-articles.ts --commit\n");
  } else {
    console.log(`\n🏁  Done. ${healed} article(s) healed and saved.`);
  }

  process.exit(0);
}

healArticles().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
