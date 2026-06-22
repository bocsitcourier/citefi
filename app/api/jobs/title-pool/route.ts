import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobBatches, users } from "@/shared/schema";
import { generateTitlePool, generateTitlePoolForMultipleCities, parseMultipleCities } from "@/lib/gemini";
import { performRedditResearch } from "@/lib/reddit-research-service";
import { smartResearch } from "@/lib/smart-topic-research";
import { eq } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(request: NextRequest) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId, userId: authenticatedUserId } = await requireTeamMember(request);

    const body = await request.json();
    const { 
      userId, 
      coreTopic, 
      targetUrl, 
      numTitles = 50, 
      tone, 
      geographicFocus, 
      audience,
      // NAP Data
      businessName,
      businessAddress,
      businessPhone,
      companyLogoUrl,
      // Advanced features
      competitorUrls = [],
      semanticClusterId,
      serpFeatureTarget
    } = body;

    // SECURITY: Use authenticated user's ID instead of body userId
    const effectiveUserId = authenticatedUserId;

    if (!coreTopic || !targetUrl) {
      console.error(`❌ Title pool validation failed: Missing coreTopic or targetUrl`, { coreTopic, targetUrl });
      return NextResponse.json(
        { error: "Missing required fields: coreTopic, targetUrl" },
        { status: 400 }
      );
    }

    if (!geographicFocus) {
      console.error(`❌ Title pool validation failed: Missing geographicFocus`);
      return NextResponse.json(
        { error: "Geographic focus is required for location-optimized SEO titles. Please specify a city, region, or area." },
        { status: 400 }
      );
    }

    if (numTitles < 5 || numTitles > 100) {
      console.error(`❌ Title pool validation failed: numTitles out of range (${numTitles})`);
      return NextResponse.json(
        { error: "numTitles must be between 5 and 100" },
        { status: 400 }
      );
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, effectiveUserId));

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if user provided multiple cities
    const cities = parseMultipleCities(geographicFocus);
    const isMultiCity = cities.length > 1;

    console.log(`🎯 Generating ${numTitles} title(s) for user ${effectiveUserId} (team ${teamId}): "${coreTopic}"${tone ? ` (Tone: ${tone})` : ''}`);
    if (isMultiCity) {
      console.log(`📍 Multi-city detected: ${cities.join(' | ')} (${cities.length} cities)`);
    }

    // ENHANCED v4.0: Perform SMART WEB RESEARCH first for hyper-relevant titles
    // Wrapped in try/catch for robustness - title generation should still work if research fails
    let researchData;
    try {
      console.log(`🔬 Performing smart web research for "${coreTopic}" in "${geographicFocus}"...`);
      researchData = await smartResearch.researchTopic(coreTopic, geographicFocus, {
        maxSearches: 10,
        includeCompetitors: true
      });
      console.log(`✅ Smart research complete: ${researchData.localEntities.length} entities, ${researchData.competitorTitles.length} competitor titles, ${researchData.suggestedAngles.length} angles`);
    } catch (researchError) {
      console.warn(`⚠️ Smart research failed, continuing without it:`, (researchError as Error).message);
      researchData = undefined;
    }
    
    // ENHANCED v3.0: Perform Reddit research BEFORE title generation for intent-based titles
    // Wrapped in try/catch — Reddit API failures must not crash the entire batch creation
    console.log(`🔍 Performing Reddit research for "${coreTopic}" in "${geographicFocus}"...`);
    let redditResearch: Awaited<ReturnType<typeof performRedditResearch>>;
    try {
      redditResearch = await performRedditResearch(coreTopic, geographicFocus, {
        maxSubreddits: 5,
        maxPostsPerSubreddit: 20,
        maxDiscussionsToAnalyze: 10
      });
      console.log(`✅ Reddit research complete: ${redditResearch.questions.length} questions mined`);
    } catch (redditError) {
      console.warn(`⚠️ Reddit research failed, continuing without it:`, (redditError as Error).message);
      redditResearch = { questions: [], subreddits: [], intentClusters: [], contentAngles: [] } as any;
    }
    
    // Extract top Reddit questions for title generation
    const redditQuestions = redditResearch.questions.map(q => ({
      question: q.question,
      upvotes: q.upvotes,
      subreddit: q.subreddit
    }));

    let titlePoolJson;
    let allTitles;
    let allKeywords;
    let strategy;

    if (isMultiCity) {
      // Generate titles for each city separately
      const numTitlesPerCity = Math.ceil(numTitles / cities.length);
      const multiCityResult = await generateTitlePoolForMultipleCities(
        coreTopic,
        targetUrl,
        numTitlesPerCity,
        tone,
        geographicFocus,
        audience,
        researchData
      );

      // Store multi-city structure with critique data
      titlePoolJson = {
        isMultiCity: true,
        cities: multiCityResult.cities,
        titles: multiCityResult.combinedTitles,
        primaryKeywords: multiCityResult.combinedKeywords,
        contentStrategy: `Multi-city strategy across ${cities.length} locations: ` + 
          multiCityResult.cities.map(c => c.contentStrategy).join(' | '),
        titlesWithScores: multiCityResult.combinedTitlesWithScores,
        critiqueSummary: multiCityResult.critiqueSummary,
        removedCount: multiCityResult.totalRemovedCount,
        refinedCount: multiCityResult.totalRefinedCount,
      };

      allTitles = multiCityResult.combinedTitles;
      allKeywords = multiCityResult.combinedKeywords;
      strategy = titlePoolJson.contentStrategy;
    } else {
      // Single city - use original function with Reddit questions AND smart research data
      const titlePoolResult = await generateTitlePool(
        coreTopic,
        targetUrl,
        numTitles,
        tone,
        geographicFocus,
        audience,
        redditQuestions,
        researchData
      );

      titlePoolJson = {
        isMultiCity: false,
        titles: titlePoolResult.titles,
        primaryKeywords: titlePoolResult.primaryKeywords,
        contentStrategy: titlePoolResult.contentStrategy,
        titlesWithScores: titlePoolResult.titlesWithScores,
        critiqueSummary: titlePoolResult.critiqueSummary,
        removedCount: titlePoolResult.removedCount,
        refinedCount: titlePoolResult.refinedCount,
      };

      allTitles = titlePoolResult.titles;
      allKeywords = titlePoolResult.primaryKeywords;
      strategy = titlePoolResult.contentStrategy;
    }

    // Extract uniqueness scores for response (already computed in generateTitlePool)
    const titlesWithScores = titlePoolJson.titlesWithScores || [];
    const critiqueSummary = titlePoolJson.critiqueSummary;
    const removedCount = titlePoolJson.removedCount || 0;
    const refinedCount = titlePoolJson.refinedCount || 0;

    const [batch] = await db
      .insert(jobBatches)
      .values({
        userId: effectiveUserId,
        teamId, // CRITICAL FIX: Add teamId for team isolation
        coreTopic,
        targetUrl,
        status: "PENDING",
        numArticlesRequested: 0,
        titlePoolJson,
        generationParams: {
          tone,
          geographicFocus,
          audience: audience || null,
          // Store Reddit research for reuse in batch SEO cache
          redditResearchCache: redditResearch
        },
        // NAP Data
        businessName: businessName || null,
        businessAddress: businessAddress || null,
        businessPhone: businessPhone || null,
        companyLogoUrl: companyLogoUrl || null,
        // Advanced features
        competitorUrlsJson: competitorUrls.length > 0 ? competitorUrls : null,
        semanticClusterId: semanticClusterId || null,
        serpFeatureTarget: serpFeatureTarget || null,
      })
      .returning();

    console.log(`✅ Title pool generated for batch ${batch!.id}${isMultiCity ? ` (${cities.length} cities, ${allTitles.length} total titles)` : ''}`);

    return NextResponse.json({
      success: true,
      batchId: batch!.id,
      isMultiCity,
      cities: isMultiCity ? cities : undefined,
      titles: allTitles,
      titlesWithScores,
      primaryKeywords: allKeywords,
      contentStrategy: strategy,
      critique: {
        summary: critiqueSummary || 'No critique performed',
        removedCount,
        refinedCount
      }
    });
  } catch (error: any) {
    console.error("❌ Title pool generation error:", error);
    return NextResponse.json(
      { 
        error: "Failed to generate title pool",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: error?.statusCode || 500 }
    );
  }
}
