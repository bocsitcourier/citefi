import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobBatches } from "@/shared/schema";
import { generateTitlePool } from "@/lib/gemini";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    
    const body = await request.json();
    const { 
      seoToolType, 
      seoToolOutput, 
      targetUrl,
      numArticles = 5,
      tone = "professional",
      geographicFocus,
    } = body;

    if (!seoToolType || !seoToolOutput || !targetUrl) {
      return NextResponse.json(
        { error: "Missing required fields: seoToolType, seoToolOutput, targetUrl" },
        { status: 400 }
      );
    }

    let coreTopic = "";
    let titlePoolResult;

    switch (seoToolType) {
      case "local_research": {
        const location = seoToolOutput.location || "";
        const businessType = seoToolOutput.business_type || "";
        coreTopic = `${businessType} in ${location}`;
        
        const localKeywords = seoToolOutput.location_keywords?.primary?.join(", ") || "";
        const localQuestions = seoToolOutput.local_questions?.map((q: any) => q.question).join(", ") || "";
        const enhancedTopic = `${coreTopic} - Focus: ${localKeywords}. Questions: ${localQuestions}`;
        
        titlePoolResult = await generateTitlePool(
          enhancedTopic.substring(0, 500),
          targetUrl,
          Math.min(numArticles * 2, 50),
          tone,
          location,
          seoToolOutput.trending_topics?.map((t: any) => t.topic).join(", ")
        );
        break;
      }

      case "competitor_analysis": {
        coreTopic = `Competitive Analysis - ${seoToolOutput.competitor_url}`;
        
        const contentGaps = seoToolOutput.content_gaps?.join(", ") || "";
        const uniqueAngles = seoToolOutput.unique_angles?.join(", ") || "";
        const enhancedTopic = `Content Opportunities: ${contentGaps}. Unique Angles: ${uniqueAngles}`;
        
        const locationForTitles = geographicFocus || "United States";
        
        titlePoolResult = await generateTitlePool(
          enhancedTopic.substring(0, 500),
          targetUrl,
          Math.min(numArticles * 2, 50),
          tone,
          locationForTitles,
          seoToolOutput.keyword_opportunities?.join(", ")
        );
        break;
      }

      case "content_structure": {
        coreTopic = seoToolOutput.title || "SEO-Optimized Content";
        
        const headings = seoToolOutput.headings?.map((h: any) => h.text).join(", ") || "";
        const keyTakeaways = seoToolOutput.key_takeaways?.join(", ") || "";
        const enhancedTopic = `${coreTopic}. Structure: ${headings}. Takeaways: ${keyTakeaways}`;
        
        const structureLocation = geographicFocus || "United States";
        
        titlePoolResult = await generateTitlePool(
          enhancedTopic.substring(0, 500),
          targetUrl,
          Math.min(numArticles * 2, 50),
          tone,
          structureLocation
        );
        break;
      }

      case "pillar_cluster": {
        const pillarTitle = seoToolOutput.pillar_page?.title || 
                           seoToolOutput.title || 
                           "Content Strategy";
        coreTopic = pillarTitle;
        
        const pillarKeywords = seoToolOutput.pillar_page?.target_keywords?.join(", ") || 
                               seoToolOutput.target_keywords?.join(", ") || "";
        const enhancedTopic = `${coreTopic}. Keywords: ${pillarKeywords}`;
        
        const pillarLocation = geographicFocus || "United States";
        
        titlePoolResult = await generateTitlePool(
          enhancedTopic.substring(0, 500),
          targetUrl,
          Math.min(numArticles * 2, 50),
          tone,
          pillarLocation,
          pillarKeywords
        );
        break;
      }

      default:
        return NextResponse.json(
          { error: "Invalid SEO tool type. Must be: local_research, competitor_analysis, content_structure, or pillar_cluster" },
          { status: 400 }
        );
    }

    const [batch] = await db
      .insert(jobBatches)
      .values({
        userId,
        teamId,
        coreTopic,
        targetUrl,
        status: "PENDING",
        numArticlesRequested: numArticles,
        titlePoolJson: {
          titles: titlePoolResult.titles,
          primaryKeywords: titlePoolResult.primaryKeywords,
          contentStrategy: titlePoolResult.contentStrategy,
          seoToolType,
          seoToolOutput,
        },
      })
      .returning();

    console.log(`✅ SEO batch created: ${batch!.id} with ${titlePoolResult.titles.length} titles from ${seoToolType}`);

    return NextResponse.json({
      success: true,
      batchId: batch!.id,
      titleCount: titlePoolResult.titles.length,
      message: `Title pool generated with ${titlePoolResult.titles.length} titles. Select titles and configure generation settings to proceed.`,
    });
  } catch (error: any) {
    console.error("❌ SEO article creation error:", error);
    return NextResponse.json(
      { 
        error: "Failed to create articles from SEO tool output",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: error?.statusCode || 500 }
    );
  }
}
