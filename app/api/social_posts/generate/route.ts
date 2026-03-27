import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { socialPosts, articles, jobBatches } from "@/shared/schema";
import { addSocialPostJob } from "@/lib/queue";
import { eq, and, or, isNull } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

const generateSocialPostSchema = z.object({
  articleId: z.string().optional(),
  standaloneTitle: z.string().optional(),
  topic: z.string().optional(),
  location: z.string().optional(),
  platforms: z.array(z.string()).min(1),
  tone: z.string().default("Professional"),
  mood: z.string().default("Informative"),
  industry: z.string().optional(),
  generateImages: z.boolean().default(true),
  generateVideos: z.boolean().default(false),
  userEmail: z.string().optional(),
  landingPageUrl: z.string().optional(),
  companyName: z.string().optional(),
  companyLogoUrl: z.string().optional(),
}).refine(data => data.articleId || data.standaloneTitle, {
  message: "Either articleId or standaloneTitle must be provided",
});

export async function POST(request: NextRequest) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { userId, teamId } = await requireTeamMember(request);

    const body = await request.json();
    const validatedData = generateSocialPostSchema.parse(body);

    let prompt = "";
    let title = validatedData.standaloneTitle || "";
    let topic = validatedData.topic || "";
    let location = validatedData.location || "";
    // companyName: prefer explicitly provided value, else auto-populate from batch below
    let resolvedCompanyName = validatedData.companyName || "";
    let resolvedCompanyLogoUrl = validatedData.companyLogoUrl || "";

    // If article ID provided, fetch article details
    if (validatedData.articleId) {
      // CRITICAL: Verify article belongs to user's team (including NULL team_id for legacy articles)
      const [article] = await db
        .select()
        .from(articles)
        .where(
          and(
            eq(articles.id, parseInt(validatedData.articleId)),
            or(
              eq(articles.teamId, teamId),
              isNull(articles.teamId) // Include articles with NULL team_id
            )
          )
        );

      if (!article) {
        return NextResponse.json(
          { error: "Article not found or access denied" },
          { status: 404 }
        );
      }

      title = article.chosenTitle;
      topic = article.chosenTitle;
      prompt = article.finalHtmlContent?.substring(0, 2000) || article.chosenTitle;
      // Keep user-submitted location, otherwise fallback to defaults
      // DON'T overwrite user's location input!
      location = validatedData.location || location || "";

      // Auto-populate companyName / logo from the article's batch when the caller
      // didn't provide them. This is the most common case — the user creates a
      // social post from an article and expects the business name to carry over.
      if (!resolvedCompanyName && article.batchId) {
        try {
          const [batch] = await db
            .select({ businessName: jobBatches.businessName, companyLogoUrl: jobBatches.companyLogoUrl })
            .from(jobBatches)
            .where(eq(jobBatches.id, article.batchId));
          if (batch?.businessName) resolvedCompanyName = batch.businessName;
          if (!resolvedCompanyLogoUrl && batch?.companyLogoUrl) resolvedCompanyLogoUrl = batch.companyLogoUrl;
        } catch {
          // Non-critical — continue without batch data
        }
      }
    } else {
      // Standalone post
      title = validatedData.standaloneTitle || "";
      topic = validatedData.topic || validatedData.standaloneTitle || "";
      prompt = `Create engaging social media content about: ${title}`;
      location = validatedData.location || location || "";
    }

    // CRITICAL: Create social_posts record with team_id
    // Truncate fields to fit database column limits
    const safeTopic = (topic || "").substring(0, 250);
    const safeTitle = (title || "").substring(0, 250);
    const safeLocation = (location || "Global").substring(0, 250);
    // resolvedCompanyName already prefers explicit user input, falls back to batch businessName
    const safeCompanyName = (resolvedCompanyName || "").substring(0, 250);
    const safeCompanyLogoUrl = (resolvedCompanyLogoUrl || "").substring(0, 500);
    
    const [socialPostRow] = await db.insert(socialPosts).values({
      userId,
      teamId, // TEAM ISOLATION
      articleId: validatedData.articleId ? parseInt(validatedData.articleId) : null,
      topic: safeTopic,
      title: safeTitle,
      location: safeLocation || "Global",
      prompt,
      tone: validatedData.tone,
      mood: validatedData.mood || "Informative",
      industry: validatedData.industry || "General",
      platformsJson: validatedData.platforms,
      landingPageUrl: validatedData.landingPageUrl || null,
      userEmail: validatedData.userEmail || null,
      companyName: safeCompanyName || null,
      companyLogoUrl: safeCompanyLogoUrl || null,
      status: "PENDING",
    }).returning();
    const socialPost = socialPostRow!;

    // Queue job for AI generation — rolls back to FAILED on any queue error
    let jobId: string | null;
    try {
      jobId = await addSocialPostJob({
        socialPostId: socialPost.id,
        userId,
        prompt,
        platforms: validatedData.platforms.map(p => p.toLowerCase()),
        tone: validatedData.tone,
        mood: validatedData.mood,
        industry: validatedData.industry,
        includeImage: validatedData.generateImages,
        generateVideos: validatedData.generateVideos,
        userEmail: validatedData.userEmail || "contact@example.com",
        articleId: validatedData.articleId ? parseInt(validatedData.articleId) : undefined,
      });
    } catch (queueErr) {
      const errMsg = queueErr instanceof Error ? queueErr.message : String(queueErr);
      console.error(`❌ Failed to queue social post ${socialPost.id}:`, errMsg);
      await db
        .update(socialPosts)
        .set({ status: "FAILED" })
        .where(eq(socialPosts.id, socialPost.id));
      return NextResponse.json(
        { error: "Failed to queue social post generation", message: errMsg },
        { status: 500 }
      );
    }

    console.log(`✅ Social post ${socialPost.id} queued with job ${jobId}`);

    return NextResponse.json({
      success: true,
      socialPostId: socialPost.id,
      jobId,
      message: `Social posts queued for ${validatedData.platforms.length} platform(s)`,
      platforms: validatedData.platforms,
    });
  } catch (error) {
    console.error("Social post generation error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to queue social post generation", message: String(error) },
      { status: 500 }
    );
  }
}
