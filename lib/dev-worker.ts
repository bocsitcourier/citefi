import { db } from "./db";
import { jobBatches, articles } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { generateArticleContent } from "./gemini";
import { finalizeContent } from "./openai";
import { cleanMetaDescription, cleanSeoTitle } from "./content-cleaner";

interface GenerationJob {
  batchId: number;
  articleId: number;
  title: string;
  targetUrl: string;
  wordCountMin: number;
  wordCountMax: number;
  tone?: string;
  geographicFocus?: string;
  audience?: string;
}

class DevWorker {
  private queue: GenerationJob[] = [];
  private processing = false;
  private concurrency = 3;
  private activeJobs = 0;

  enqueue(job: GenerationJob) {
    this.queue.push(job);
    console.log(`📋 Enqueued article: "${job.title}" (queue length: ${this.queue.length})`);
  }
  
  startProcessing() {
    if (!this.processing && this.queue.length > 0) {
      console.log(`🚀 Starting worker with ${this.queue.length} jobs in queue`);
      this.processQueue().catch(err => {
        console.error("❌ Worker processQueue failed:", err);
      });
    }
  }

  enqueueBatch(
    batchId: number,
    articles: Array<{ id: number; title: string }>,
    params: {
      targetUrl: string;
      wordCountMin: number;
      wordCountMax: number;
      tone?: string;
      geographicFocus?: string;
      audience?: string;
    }
  ) {
    console.log(`📦 Enqueueing batch ${batchId} with ${articles.length} articles`);
    for (const article of articles) {
      this.enqueue({
        batchId,
        articleId: article.id,
        title: article.title,
        ...params,
      });
    }
    console.log(`✅ Batch enqueued. Queue now has ${this.queue.length} jobs`);
    this.startProcessing();
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;
    console.log(`🔄 Starting article generation worker (concurrency: ${this.concurrency})`);

    while (this.queue.length > 0 || this.activeJobs > 0) {
      while (this.activeJobs < this.concurrency && this.queue.length > 0) {
        const job = this.queue.shift()!;
        this.activeJobs++;
        this.processJob(job).finally(() => {
          this.activeJobs--;
        });
      }
      
      if (this.queue.length === 0 && this.activeJobs === 0) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.processing = false;
    console.log(`✅ Worker finished processing all articles`);
  }

  private async processJob(job: GenerationJob) {
    const { batchId, articleId, title, targetUrl, wordCountMin, wordCountMax, tone, geographicFocus, audience } = job;
    
    try {
      console.log(`📝 Generating: "${title}" (article ${articleId})`);
      
      await db.update(articles)
        .set({ articleStatus: "IN_PROGRESS", updatedAt: new Date() })
        .where(eq(articles.id, articleId));

      console.log(`⏳ Calling Gemini API for article ${articleId}...`);
      const geminiStart = Date.now();
      
      const geminiResult = await Promise.race([
        generateArticleContent(
          title,
          targetUrl,
          wordCountMin,
          wordCountMax,
          tone,
          geographicFocus,
          audience
        ),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Gemini API timeout after 60 seconds')), 60000)
        )
      ]);
      
      console.log(`✓ Gemini API completed in ${(Date.now() - geminiStart) / 1000}s for article ${articleId}`);

      await db.update(articles)
        .set({
          articleStatus: "GEMINI_DONE",
          seoTitle: cleanSeoTitle(geminiResult.seoTitle),
          metaDescription: cleanMetaDescription(geminiResult.metaDescription),
          slug: geminiResult.slug.substring(0, 255),
          keywordsJson: geminiResult.keywords,
          hashtagsJson: geminiResult.hashtags,
          wordCount: geminiResult.wordCount,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, articleId));

      const finalHtml = await finalizeContent({
        articleText: geminiResult.articleText,
        keywords: geminiResult.keywords,
        targetUrl,
        imageUrls: [],
        hashtags: geminiResult.hashtags,
      });

      await db.update(articles)
        .set({
          finalHtmlContent: finalHtml,
          articleStatus: "COMPLETE",
          updatedAt: new Date(),
        })
        .where(eq(articles.id, articleId));

      console.log(`✅ Complete: "${title}" (article ${articleId})`);

      const allArticles = await db.select().from(articles).where(eq(articles.batchId, batchId));
      const completed = allArticles.filter(a => a.articleStatus === "COMPLETE").length;
      const total = allArticles.length;

      if (completed === total) {
        await db.update(jobBatches)
          .set({ status: "COMPLETE", completedAt: new Date() })
          .where(eq(jobBatches.id, batchId));
        console.log(`🎉 Batch ${batchId} complete: ${completed}/${total} articles`);
      }
    } catch (error) {
      console.error(`❌ Failed to generate article "${title}":`, error);
      
      await db.update(articles)
        .set({ 
          articleStatus: "PENDING",
          updatedAt: new Date(),
        })
        .where(eq(articles.id, articleId));
    }
  }

  getQueueLength() {
    return this.queue.length;
  }

  getActiveJobs() {
    return this.activeJobs;
  }
  
  async recoverPendingArticles(batchId: number) {
    console.log(`🔍 Checking for pending articles in batch ${batchId}`);
    
    const batch = await db.select().from(jobBatches).where(eq(jobBatches.id, batchId)).limit(1);
    if (batch.length === 0 || batch[0].status === "COMPLETE") {
      return;
    }
    
    const pendingArticles = await db
      .select()
      .from(articles)
      .where(eq(articles.batchId, batchId));
    
    const pending = pendingArticles.filter(a => a.articleStatus === "PENDING");
    
    if (pending.length === 0) {
      console.log(`✓ No pending articles found in batch ${batchId}`);
      return;
    }
    
    console.log(`🔄 Recovering ${pending.length} pending articles from batch ${batchId}`);
    
    const batchData = batch[0];
    for (const article of pending) {
      this.enqueue({
        batchId,
        articleId: article.id,
        title: article.chosenTitle,
        targetUrl: batchData.targetUrl,
        wordCountMin: 800,
        wordCountMax: 2000,
        tone: undefined,
        geographicFocus: undefined,
        audience: undefined,
      });
    }
    
    this.startProcessing();
  }
}

let workerInstance: DevWorker | null = null;

export function getDevWorker(): DevWorker {
  if (!workerInstance) {
    console.log("🆕 Creating new DevWorker instance");
    workerInstance = new DevWorker();
  }
  return workerInstance;
}
