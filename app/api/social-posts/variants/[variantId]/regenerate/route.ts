import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { socialPosts, socialPostVariants, socialPostLogs, ContentType } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { runGenerationOrchestrator } from "@/lib/generation-orchestrator";
import { recordContentGenerated, getPromptEnhancement } from "@/lib/learning-integration";

const CHAR_LIMITS = {
  x: 280,
  twitter: 280,
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  pinterest: 500,
} as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ variantId: string }> }
) {
  try {
    const { variantId } = await params;
    const variantIdNum = parseInt(variantId, 10);

    if (isNaN(variantIdNum)) {
      return NextResponse.json({ error: "Invalid variant ID" }, { status: 400 });
    }

    const auth = await requireTeamMember(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [variant] = await db
      .select()
      .from(socialPostVariants)
      .where(eq(socialPostVariants.id, variantIdNum));

    if (!variant) {
      return NextResponse.json({ error: "Variant not found" }, { status: 404 });
    }

    const [post] = await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.id, variant.socialPostId));

    if (!post) {
      return NextResponse.json({ error: "Parent social post not found" }, { status: 404 });
    }

    if (post.teamId !== auth.teamId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    await db
      .update(socialPostVariants)
      .set({ status: "GENERATING", errorMessage: null })
      .where(eq(socialPostVariants.id, variantIdNum));

    const platform = variant.platform.toLowerCase();
    const characterLimit = CHAR_LIMITS[platform as keyof typeof CHAR_LIMITS] || 2200;

    console.log(`🔄 Regenerating ${platform} variant ${variantIdNum} for social post ${post.id}`);

    const { generateSocialPostWithGemini } = await import("@/lib/gemini-social");
    const { enhanceSocialPostWithGPT } = await import("@/lib/openai-social");

    const prompt = post.topic || post.title || "Social media content";
    
    const geminiResult = await generateSocialPostWithGemini({
      prompt,
      platform,
      tone: post.tone || "professional",
      mood: post.mood || "informative",
      industry: post.industry || "general",
      characterLimit,
      location: post.location || undefined,
      topic: post.topic || undefined,
      title: post.title || undefined,
      companyName: post.companyName || undefined,
    });

    console.log(`✅ Gemini regenerated ${platform} post (${geminiResult.caption.length} chars)`);

    const gptResult = await enhanceSocialPostWithGPT({
      caption: geminiResult.caption,
      platform,
      tone: post.tone || "professional",
      userEmail: post.userEmail || "contact@example.com",
      location: post.location || undefined,
      topic: post.topic || undefined,
      industry: post.industry || undefined,
      landingPageUrl: post.landingPageUrl || undefined,
      companyName: post.companyName || undefined,
    });

    console.log(`✅ GPT-4 enhanced ${platform} post with ${gptResult.hashtags.length} hashtags`);

    // Critic loop: wire orchestrator for quality scoring + repairs (mirrors social-worker.ts)
    // Fetch learned patterns so Wilson/EMA attribution fires on regenerated content.
    const socialEnhancement = await getPromptEnhancement(post.teamId, ContentType.SOCIAL)
      .catch(() => ({ patternsUsed: [] as number[] }));
    const patternsForRegen = socialEnhancement.patternsUsed;

    let finalCaption = gptResult.caption;
    try {
      const orchResult = await runGenerationOrchestrator({
        teamId: post.teamId,
        contentType: ContentType.SOCIAL,
        contentId: post.id,
        content: gptResult.caption,
        patternsUsed: patternsForRegen,
        brief: {
          topic: post.topic ?? undefined,
          location: post.location ?? undefined,
        },
        kind: "social",
      });
      if (orchResult.repairs > 0 && orchResult.content.length > 20 && orchResult.orchestrated) {
        finalCaption = orchResult.content;
        console.log(`🔧 Social variant ${variantIdNum} critic: ${orchResult.repairs} repair(s), quality=${orchResult.qualityScore}`);
      }
      await recordContentGenerated(
        post.teamId,
        ContentType.SOCIAL,
        post.id,
        patternsForRegen,
        orchResult.qualityScore > 0 ? orchResult.qualityScore : 75,
        { armId: orchResult.armId }
      );
    } catch (orchErr) {
      console.warn(`[Social Regenerate] Orchestrator failed, continuing:`, (orchErr as Error).message);
    }

    const hashtagsString = gptResult.hashtags.map(h => h.tag).join(" ");

    await db
      .update(socialPostVariants)
      .set({
        caption: finalCaption,
        characterCount: finalCaption.length,
        hashtags: hashtagsString,
        hashtagsJson: gptResult.hashtags,
        emojisJson: gptResult.emojis || [],
        hyperlinksJson: gptResult.hyperlinks || [],
        status: "READY",
        errorMessage: null,
      })
      .where(eq(socialPostVariants.id, variantIdNum));

    await db.insert(socialPostLogs).values({
      socialPostId: post.id,
      eventType: "VARIANT_REGENERATED",
      stage: "GPT4",
      severity: "info",
      message: `Regenerated ${platform} variant (${finalCaption.length} chars, ${gptResult.hashtags.length} hashtags)`,
      payloadJson: {
        variantId: variantIdNum,
        platform,
        characterCount: finalCaption.length,
        hashtagCount: gptResult.hashtags.length,
      },
    });

    console.log(`✅ Successfully regenerated ${platform} variant ${variantIdNum}`);

    return NextResponse.json({
      success: true,
      variant: {
        id: variantIdNum,
        platform,
        caption: finalCaption,
        characterCount: finalCaption.length,
        hashtags: gptResult.hashtags,
        emojis: gptResult.emojis || [],
        hyperlinks: gptResult.hyperlinks || [],
        status: "READY",
      },
    });
  } catch (error: any) {
    console.error("❌ Variant regeneration failed:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    const { variantId } = await params;
    const variantIdNum = parseInt(variantId, 10);
    
    if (!isNaN(variantIdNum)) {
      await db
        .update(socialPostVariants)
        .set({
          status: "FAILED",
          errorMessage: errorMessage.slice(0, 500),
        })
        .where(eq(socialPostVariants.id, variantIdNum));
    }

    return NextResponse.json(
      { error: "Regeneration failed", message: errorMessage },
      { status: error?.statusCode || 500 }
    );
  }
}
