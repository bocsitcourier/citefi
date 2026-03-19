import axios from "axios";

const API_BASE = "http://localhost:5000";

interface BatchStatus {
  id: number;
  status: string;
  numArticlesRequested?: number;
}

interface MonitoringData {
  liveStatus: {
    batchId: number;
    status: string;
    progress: number;
    articlesCompleted: number;
    articlesTotal: number;
    articlesInProgress: number;
    articlesFailed: number;
    estimatedTimeRemaining: number;
    currentCost: number;
    recentErrors: Array<{ message: string; timestamp: Date }>;
  };
  performanceMetrics: {
    batchId: number;
    totalArticles: number;
    completedArticles: number;
    failedArticles: number;
    averageTimePerArticle: number;
    totalDuration: number;
    concurrentWorkers: number;
    imagesGenerated: number;
    podcastsGenerated: number;
    errorRate: number;
  };
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateTitlePool() {
  console.log("\n🎯 Step 1: Generating title pool (50 SEO-optimized titles)...\n");
  
  const response = await axios.post(`${API_BASE}/api/batches/titles`, {
    topic: "AI-powered marketing automation for small businesses",
    location: "Austin, Texas, USA",
    industry: "Marketing Technology",
    niche: "Small Business Software",
    numTitles: 50,
  });
  
  const titlePoolId = response.data.titlePoolId;
  console.log(`✅ Title pool created: ID ${titlePoolId}`);
  
  await sleep(3000);
  
  const poolResponse = await axios.get(`${API_BASE}/api/batches/titles/${titlePoolId}`);
  const titles = poolResponse.data.titles;
  
  console.log(`✅ Generated ${titles.length} titles`);
  console.log("\nSample titles:");
  titles.slice(0, 5).forEach((t: string, i: number) => {
    console.log(`  ${i + 1}. ${t}`);
  });
  
  return { titlePoolId, titles };
}

async function submitBatchGeneration(titlePoolId: number) {
  console.log("\n🚀 Step 2: Submitting batch generation (50 articles)...\n");
  
  const response = await axios.post(`${API_BASE}/api/batches/generate`, {
    titlePoolId,
    numArticles: 50,
    location: "Austin, Texas, USA",
    tone: "Professional and informative",
    industry: "Marketing Technology",
  });
  
  const batchId = response.data.batchId;
  console.log(`✅ Batch submitted: ID ${batchId}`);
  console.log(`   - 50 articles queued for generation`);
  console.log(`   - 100 concurrent workers will process jobs`);
  console.log(`   - 10 image workers for parallel image generation`);
  
  return batchId;
}

async function monitorBatchProgress(batchId: number): Promise<MonitoringData> {
  console.log(`\n📊 Step 3: Monitoring batch ${batchId} progress...\n`);
  
  let isComplete = false;
  let lastProgress = -1;
  let monitoringData: MonitoringData | null = null;
  
  while (!isComplete) {
    try {
      const response = await axios.get(`${API_BASE}/api/monitoring/batch/${batchId}`);
      monitoringData = response.data;
      
      const { liveStatus, performanceMetrics } = monitoringData;
      
      if (liveStatus.progress !== lastProgress) {
        const progressBar = "█".repeat(Math.floor(liveStatus.progress / 2)) + 
                           "░".repeat(50 - Math.floor(liveStatus.progress / 2));
        
        console.log(`\n[${new Date().toLocaleTimeString()}] Progress Update:`);
        console.log(`   ${progressBar} ${liveStatus.progress.toFixed(1)}%`);
        console.log(`   ✅ Completed: ${liveStatus.articlesCompleted}/${liveStatus.articlesTotal}`);
        console.log(`   🔄 In Progress: ${liveStatus.articlesInProgress}`);
        console.log(`   ❌ Failed: ${liveStatus.articlesFailed}`);
        console.log(`   💰 Current Cost: $${liveStatus.currentCost.toFixed(4)}`);
        
        if (performanceMetrics.averageTimePerArticle > 0) {
          console.log(`   ⏱️  Avg Time/Article: ${(performanceMetrics.averageTimePerArticle / 1000).toFixed(1)}s`);
        }
        
        if (liveStatus.recentErrors.length > 0) {
          console.log(`   ⚠️  Recent errors: ${liveStatus.recentErrors.length}`);
        }
        
        lastProgress = liveStatus.progress;
      }
      
      if (liveStatus.status === "COMPLETE" || liveStatus.status === "FAILED") {
        isComplete = true;
        console.log(`\n✨ Batch ${liveStatus.status.toLowerCase()}!\n`);
      }
    } catch (error) {
      console.error(`   ⚠️  Error fetching monitoring data:`, error instanceof Error ? error.message : "Unknown error");
    }
    
    if (!isComplete) {
      await sleep(3000);
    }
  }
  
  return monitoringData!;
}

async function generateReport(batchId: number, monitoringData: MonitoringData) {
  console.log("\n" + "=".repeat(80));
  console.log("📊 PRODUCTION TEST REPORT - 50 ARTICLE GENERATION");
  console.log("=".repeat(80));
  
  const { liveStatus, performanceMetrics } = monitoringData;
  
  console.log("\n📈 BATCH SUMMARY");
  console.log("-".repeat(80));
  console.log(`   Batch ID:              ${batchId}`);
  console.log(`   Status:                ${liveStatus.status}`);
  console.log(`   Total Articles:        ${liveStatus.articlesTotal}`);
  console.log(`   Completed:             ${liveStatus.articlesCompleted}`);
  console.log(`   Failed:                ${liveStatus.articlesFailed}`);
  console.log(`   Success Rate:          ${((liveStatus.articlesCompleted / liveStatus.articlesTotal) * 100).toFixed(1)}%`);
  
  console.log("\n⚡ PERFORMANCE METRICS");
  console.log("-".repeat(80));
  console.log(`   Total Duration:        ${(performanceMetrics.totalDuration / 60000).toFixed(2)} minutes`);
  console.log(`   Avg Time/Article:      ${(performanceMetrics.averageTimePerArticle / 1000).toFixed(2)} seconds`);
  console.log(`   Concurrent Workers:    ${performanceMetrics.concurrentWorkers}`);
  console.log(`   Images Generated:      ${performanceMetrics.imagesGenerated}`);
  console.log(`   Podcasts Generated:    ${performanceMetrics.podcastsGenerated}`);
  console.log(`   Error Rate:            ${performanceMetrics.errorRate.toFixed(2)}%`);
  
  console.log("\n💰 COST ANALYSIS");
  console.log("-".repeat(80));
  console.log(`   Total Cost:            $${liveStatus.currentCost.toFixed(4)}`);
  console.log(`   Cost Per Article:      $${(liveStatus.currentCost / liveStatus.articlesCompleted).toFixed(4)}`);
  
  const throughput = performanceMetrics.totalDuration > 0
    ? (liveStatus.articlesCompleted / (performanceMetrics.totalDuration / 60000))
    : 0;
  
  console.log("\n🚀 THROUGHPUT ANALYSIS");
  console.log("-".repeat(80));
  console.log(`   Articles/Minute:       ${throughput.toFixed(2)}`);
  console.log(`   Articles/Hour:         ${(throughput * 60).toFixed(0)}`);
  
  if (liveStatus.recentErrors.length > 0) {
    console.log("\n⚠️  RECENT ERRORS");
    console.log("-".repeat(80));
    liveStatus.recentErrors.forEach((error, i) => {
      console.log(`   ${i + 1}. [${new Date(error.timestamp).toLocaleTimeString()}] ${error.message}`);
    });
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("✅ TEST COMPLETE");
  console.log("=".repeat(80) + "\n");
}

async function main() {
  try {
    console.log("\n🏭 APEXCONTENT ENGINE - PRODUCTION TEST");
    console.log("   Testing 50-article generation with full pipeline");
    console.log("   Including: Gemini 2.0 Flash + GPT-4o-mini + Images\n");
    
    const startTime = Date.now();
    
    const { titlePoolId } = await generateTitlePool();
    const batchId = await submitBatchGeneration(titlePoolId);
    const monitoringData = await monitorBatchProgress(batchId);
    
    await generateReport(batchId, monitoringData);
    
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;
    
    console.log(`\n⏱️  Total test execution time: ${totalTime.toFixed(2)} seconds\n`);
    
  } catch (error) {
    console.error("\n❌ Test failed:", error instanceof Error ? error.message : "Unknown error");
    if (axios.isAxiosError(error)) {
      console.error("   API Error:", error.response?.data || error.message);
    }
    process.exit(1);
  }
}

main();
