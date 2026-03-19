import { db } from '../lib/db';
import { articles, jobBatches } from '../shared/schema';
import { eq, inArray } from 'drizzle-orm';
import { addArticleJob } from '../lib/queue';

async function createJobsForGeminiComplete() {
  console.log('🔍 Finding GEMINI_COMPLETE articles...');
  
  const geminiArticles = await db
    .select()
    .from(articles)
    .where(inArray(articles.batchId, [60, 61]))
    .where(eq(articles.articleStatus, 'GEMINI_COMPLETE'));
  
  console.log(`Found ${geminiArticles.length} articles at GEMINI_COMPLETE`);
  
  // Get batch details for each article
  const batches = await db
    .select()
    .from(jobBatches)
    .where(inArray(jobBatches.id, [60, 61]));
  
  const batchMap = new Map(batches.map(b => [b.id, b]));
  
  let created = 0;
  let failed = 0;
  
  for (const article of geminiArticles) {
    try {
      const batch = batchMap.get(article.batchId);
      if (!batch) {
        console.error(`❌ Article ${article.id}: batch ${article.batchId} not found`);
        failed++;
        continue;
      }
      
      await addArticleJob({
        articleId: article.id,
        batchId: article.batchId,
        runId: crypto.randomUUID(),
        title: article.chosenTitle,
        targetUrl: batch.targetUrl || '',
        tone: batch.tone || 'professional',
        wordCountMin: batch.wordCountMin || 800,
        wordCountMax: batch.wordCountMax || 2000,
        geographicFocus: batch.geographicFocus || '',
        audience: batch.audience || '',
        businessName: batch.businessName || '',
        companyLogoUrl: batch.companyLogoUrl || undefined,
        competitorUrls: batch.competitorUrls || undefined,
        semanticClusterId: undefined,
        serpFeatureTarget: batch.serpFeatureTarget || undefined,
        customInstructions: undefined,
      });
      
      created++;
      console.log(`✅ Created job for article ${article.id}: ${article.chosenTitle.substring(0, 50)}...`);
    } catch (err: any) {
      console.error(`❌ Failed to create job for article ${article.id}:`, err.message);
      failed++;
    }
  }
  
  console.log(`\n✅ Summary: ${created} jobs created, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

createJobsForGeminiComplete();
