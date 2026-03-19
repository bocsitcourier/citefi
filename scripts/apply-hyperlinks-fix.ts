import { db } from "../lib/db";
import { articles } from "../shared/schema";
import { eq } from "drizzle-orm";
import { applyKeywordHyperlinks } from "../lib/keyword-hyperlink-pipeline";

async function applyHyperlinksToArticle(articleId: number) {
  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, articleId));

  if (!article) {
    console.log("Article not found");
    return;
  }

  const keywords = (article.hyperlinkedKeywordsJson as any[]) || [];
  const targetUrl = keywords[0]?.url || "https://privateinhomecaregiver.com";
  
  // Extract phrase strings from keyword objects
  const keywordStrings = keywords.map((k: any) => k.phrase || k.keyword || k.anchorText).filter(Boolean);
  
  console.log(`Applying ${keywordStrings.length} hyperlinks to article ${articleId}...`);
  console.log("Sample keywords:", keywordStrings.slice(0, 3));
  
  const result = applyKeywordHyperlinks(
    article.finalHtmlContent || "",
    keywordStrings,
    targetUrl,
    { excludeHeaders: true, includeFaq: true, maxLinksPerKeyword: 1 }
  );
  
  console.log(`✅ Applied ${result.keywordsLinked} body hyperlinks`);
  console.log(`⚠️ Missing: ${result.keywordsMissing.length} keywords not found in text`);
  if (result.keywordsMissing.length > 0) {
    console.log("   Missing:", result.keywordsMissing.slice(0, 3).join(", "));
  }
  
  // Update the article
  await db
    .update(articles)
    .set({ finalHtmlContent: result.correctedHtml })
    .where(eq(articles.id, articleId));
  
  console.log("✅ Article 640 updated with body hyperlinks!");
}

applyHyperlinksToArticle(640).then(() => process.exit(0)).catch(console.error);
