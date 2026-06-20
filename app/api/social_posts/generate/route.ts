import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { socialPosts, articles, jobBatches } from "@/shared/schema";
import { addSocialPostJob } from "@/lib/queue";
import { reserveCredits, releaseReservation } from "@/lib/billing";
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
      // Verify article belongs to this team — strict ownership, no NULL-team fallback
      const [article] = await db
        .select()
        .from(articles)
        .where(
          and(
            eq(articles.id, parseInt(validatedData.articleId)),
            eq(articles.teamId, teamId)
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

    // Truncate fields to fit database column limits
    const safeTopic = (topic || "").substring(0, 250);
    const safeTitle = (title || "").substring(0, 250);
    const safeLocation = (location || "Global").substring(0, 250);
    const safeCompanyName = (resolvedCompanyName || "").substring(0, 250);
    const safeCompanyLogoUrl = (resolvedCompanyLogoUrl || "").substring(0, 500);

    // Per-request idempotency key — scoped to teamId to prevent cross-tenant collision
    const requestKey = request.headers.get("X-Idempotency-Key") ?? crypto.randomUUID();

    // Sentinel stored in jobId to signal a concurrent resume is in progress.
    // Distinguishable from a real pg-boss UUID (which is a proper UUID string).
    const RESUME_SENTINEL = "__resuming__";

    // pg-boss singletonKey: prevents duplicate jobs even if the process crashes
    // between addSocialPostJob() and persisting jobId to the DB row.
    const singletonKey = `social:${teamId}:${requestKey}`;

    // State-aware idempotency: look up an existing (teamId, requestKey) row.
    // FAILED rows have requestKey cleared on failure so only live rows appear here.
    const [existingPost] = await db
      .select({ id: socialPosts.id, jobId: socialPosts.jobId, status: socialPosts.status })
      .from(socialPosts)
      .where(and(eq(socialPosts.teamId, teamId), eq(socialPosts.requestKey, requestKey)))
      .limit(1);

    if (existingPost) {
      const realJobId = existingPost.jobId !== RESUME_SENTINEL ? existingPost.jobId : null;

      // Non-PENDING/FAILED status means the worker already has (or had) the job.
      // Return success immediately — no re-queue even if jobId was never persisted
      // (covers the crash-before-persist scenario where the worker ran to completion).
      const isWorkerActive =
        existingPost.status != null && !["PENDING", "FAILED"].includes(existingPost.status);

      if (realJobId || isWorkerActive) {
        return NextResponse.json({
          success: true,
          socialPostId: existingPost.id,
          jobId: realJobId,
          status: existingPost.status,
          message: realJobId
            ? "Social post already queued (idempotent retry)"
            : "Social post job is processing",
          platforms: validatedData.platforms,
        });
      }

      if (existingPost.jobId === RESUME_SENTINEL) {
        // Another concurrent request is actively resuming — ask client to retry
        return NextResponse.json({ error: "Previous attempt pending, please retry shortly" }, { status: 409 });
      }

      // jobId is null AND status is PENDING — atomically claim the resume slot.
      // Others see the sentinel and return 409.
      const [claimed] = await db
        .update(socialPosts)
        .set({ jobId: RESUME_SENTINEL })
        .where(and(eq(socialPosts.id, existingPost.id), isNull(socialPosts.jobId)))
        .returning({ id: socialPosts.id });

      if (!claimed) {
        // Lost the race — another concurrent request claimed the slot
        return NextResponse.json({ error: "Previous attempt pending, please retry shortly" }, { status: 409 });
      }

      // Re-read status post-claim to close the TOCTOU window:
      // the job may have transitioned from PENDING→GENERATING/READY while we
      // were racing to claim the sentinel.
      const [postClaim] = await db
        .select({ status: socialPosts.status })
        .from(socialPosts)
        .where(eq(socialPosts.id, existingPost.id))
        .limit(1);
      const postClaimActive =
        postClaim?.status != null && !["PENDING", "FAILED"].includes(postClaim.status);
      if (postClaimActive) {
        // Worker transitioned mid-race — release sentinel, return success
        await db.update(socialPosts).set({ jobId: null }).where(eq(socialPosts.id, existingPost.id)).catch(() => {});
        return NextResponse.json({
          success: true,
          socialPostId: existingPost.id,
          jobId: null,
          status: postClaim!.status,
          message: "Social post job is processing",
          platforms: validatedData.platforms,
        });
      }

      // Sole claimer in PENDING state — queue without charging again.
      // Track whether the failure was a real queue error vs singletonKey collision.
      let resumeJobId: string | null = null;
      let queueThrew = false;
      try {
        resumeJobId = await addSocialPostJob({
          socialPostId: existingPost.id,
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
        }, { singletonKey });
        if (resumeJobId) {
          await db.update(socialPosts).set({ jobId: resumeJobId }).where(eq(socialPosts.id, existingPost.id)).catch(() => {});
        }
      } catch {
        queueThrew = true;
        // Real queue failure — release sentinel so a future retry can try again
        await db.update(socialPosts).set({ jobId: null }).where(eq(socialPosts.id, existingPost.id)).catch(() => {});
      }

      if (queueThrew) {
        // Genuine queue outage — not a "job already running" case; surface the error
        return NextResponse.json({ error: "Failed to queue social post generation" }, { status: 500 });
      }

      if (!resumeJobId) {
        // singletonKey collision: original job is still pending/active in pg-boss.
        // Release sentinel so future retries don't get permanently blocked.
        await db.update(socialPosts).set({ jobId: null }).where(eq(socialPosts.id, existingPost.id)).catch(() => {});
        return NextResponse.json({
          success: true,
          socialPostId: existingPost.id,
          jobId: null,
          message: "Job already running — track by socialPostId",
          platforms: validatedData.platforms,
        }, { status: 202 });
      }

      return NextResponse.json({
        success: true,
        socialPostId: existingPost.id,
        jobId: resumeJobId,
        message: "Social post queued (resumed)",
        platforms: validatedData.platforms,
      });
    }

    // Two-bucket billing: RESERVE credits atomically before queuing.
    // The worker debits on success or releases on failure — no charge for failed jobs.
    const creditRunId = `social:${teamId}:${requestKey}`;
    const reservation = await reserveCredits({
      teamId,
      operationType: "social_batch",
      runId: creditRunId,
      userId,
    });

    if (!reservation.ok) {
      return NextResponse.json(
        {
          error: "CREDITS_EXHAUSTED",
          creditCost: reservation.requiredCredits,
          sufficient: false,
          allowanceRemaining: reservation.allowanceRemaining,
          purchasedRemaining: reservation.purchasedRemaining,
          totalRemaining: reservation.totalRemaining,
          insufficientBy: reservation.insufficientBy,
          upgradeUrl: "/settings/billing",
          message: `Insufficient credits. You need ${reservation.requiredCredits} but have ${reservation.totalRemaining} available.`,
        },
        { status: 402 }
      );
    }

    // Create social_posts record. On a requestKey unique-constraint violation, a concurrent
    // request already won the race — look up its row and return it without refunding (the
    // debit is idempotent and shared). Only refund on genuine (non-idempotency) DB errors.
    let socialPost;
    try {
      const [socialPostRow] = await db.insert(socialPosts).values({
        userId,
        teamId,
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
        requestKey,
        status: "PENDING",
      }).returning();
      socialPost = socialPostRow!;
    } catch (createErr) {
      const isUniqueConflict = (createErr as any)?.code === "23505";
      if (isUniqueConflict) {
        // Concurrent request won the insert race — look up its row. Do NOT refund (the
        // debit is idempotent and shared). Apply the same state-aware jobId check:
        // only return success when a real jobId is present; otherwise 409.
        const [concurrent] = await db
          .select({ id: socialPosts.id, jobId: socialPosts.jobId })
          .from(socialPosts)
          .where(and(eq(socialPosts.teamId, teamId), eq(socialPosts.requestKey, requestKey)))
          .limit(1);
        if (concurrent) {
          const concurrentRealJobId =
            concurrent.jobId && concurrent.jobId !== RESUME_SENTINEL ? concurrent.jobId : null;
          if (concurrentRealJobId) {
            return NextResponse.json({
              success: true,
              socialPostId: concurrent.id,
              jobId: concurrentRealJobId,
              message: `Social post already queued (idempotent retry)`,
              platforms: validatedData.platforms,
            });
          }
          // Winner hasn't queued yet — let client retry
          return NextResponse.json({ error: "Previous attempt pending, please retry shortly" }, { status: 409 });
        }
      }
      // Genuine DB error — release reservation (no charge)
      await releaseReservation({ teamId, runId: creditRunId, reason: "Social post DB creation failure" }).catch(() => {});
      return NextResponse.json({ error: "Failed to create social post" }, { status: 500 });
    }

    // Queue job for AI generation
    let jobId: string | null;
    try {
      jobId = await addSocialPostJob({
        socialPostId: socialPost.id,
        userId,
        teamId,
        creditRunId,
        prompt,
        platforms: validatedData.platforms.map(p => p.toLowerCase()),
        tone: validatedData.tone,
        mood: validatedData.mood,
        industry: validatedData.industry,
        includeImage: validatedData.generateImages,
        generateVideos: validatedData.generateVideos,
        userEmail: validatedData.userEmail || "contact@example.com",
        articleId: validatedData.articleId ? parseInt(validatedData.articleId) : undefined,
      }, { singletonKey });
    } catch (queueErr) {
      const errMsg = queueErr instanceof Error ? queueErr.message : String(queueErr);
      console.error(`❌ Failed to queue social post ${socialPost.id}:`, errMsg);
      // Clear requestKey so a retry can create a fresh row and re-queue
      await db.update(socialPosts)
        .set({ status: "FAILED", requestKey: null })
        .where(eq(socialPosts.id, socialPost.id))
        .catch(() => {});
      // Release reservation — no charge for queue failure
      await releaseReservation({ teamId, runId: creditRunId, reason: `Social post ${socialPost.id} queue failure` }).catch(() => {});
      return NextResponse.json(
        { error: "Failed to queue social post generation", message: errMsg },
        { status: 500 }
      );
    }

    // Guard: null return means singletonKey collision — another concurrent request
    // already queued this operation. No refund (debit is shared). Return success
    // with null jobId so the client can track by socialPostId instead.
    if (!jobId) {
      return NextResponse.json({
        success: true,
        socialPostId: socialPost.id,
        jobId: null,
        message: "Job already queued by concurrent request — track by socialPostId",
        platforms: validatedData.platforms,
      });
    }

    // Persist jobId so idempotent retries can return the real job reference
    await db.update(socialPosts).set({ jobId }).where(eq(socialPosts.id, socialPost.id)).catch(() => {});

    console.log(`✅ Social post ${socialPost.id} queued with job ${jobId}`);

    return NextResponse.json({
      success: true,
      socialPostId: socialPost.id,
      jobId,
      message: `Social posts queued for ${validatedData.platforms.length} platform(s)`,
      platforms: validatedData.platforms,
    });
  } catch (error: any) {
    console.error("Social post generation error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to queue social post generation", message: String(error) },
      { status: error?.statusCode || 500 }
    );
  }
}
