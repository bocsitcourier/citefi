import { db } from "../lib/db";
import { articles } from "../shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { applyKeywordHyperlinks } from "../lib/keyword-hyperlink-pipeline";

async function applyHyperlinksToBatches(batchIds: number[]) {
  const batchArticles = await db
    .select()
    .from(articles)
    .where(and(
      inArray(articles.batchId, batchIds),
      inArray(articles.articleStatus, ["COMPLETE", "GPT4_ENHANCED", "REVIEWED", "CHATGPT_REVIEWED"])
    ));

  console.log(`Found ${batchArticles.length} articles in batches ${batchIds.join(", ")}`);
  
  let totalFixed = 0;
  let totalSkipped = 0;
  
  for (const article of batchArticles) {
    const keywords = (article.hyperlinkedKeywordsJson as any[]) || [];
    if (keywords.length === 0) {
      console.log(`⏭️ Article ${article.id}: No keywords stored, skipping`);
      totalSkipped++;
      continue;
    }
    
    const targetUrl = keywords[0]?.url || "";
    if (!targetUrl) {
      console.log(`⏭️ Article ${article.id}: No target URL, skipping`);
      totalSkipped++;
      continue;
    }
    
    // Extract phrase strings from keyword objects
    const keywordStrings = keywords.map((k: any) => k.phrase || k.keyword || k.anchorText).filter(Boolean);
    
    const result = applyKeywordHyperlinks(
      article.finalHtmlContent || "",
      keywordStrings,
      targetUrl,
      { excludeHeaders: true, includeFaq: true, maxLinksPerKeyword: 1 }
    );
    
    // Update the article
    await db
      .update(articles)
      .set({ finalHtmlContent: result.correctedHtml })
      .where(eq(articles.id, article.id));
    
    console.log(`✅ Article ${article.id}: Applied ${result.keywordsLinked} hyperlinks`);
    totalFixed++;
  }
  
  console.log(`\n🎉 Done! Fixed ${totalFixed} articles, skipped ${totalSkipped}`);
}

applyHyperlinksToBatches([65, 66]).then(() => process.exit(0)).catch(console.error);
