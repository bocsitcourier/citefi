import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { generateArticlePodcast } from "@/lib/podcast-worker";
import { requireTeamMember } from "@/lib/api/auth";
import { debitCredits, refundCredits } from "@/lib/credits";

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const body = await request.json();
    const { articleId, tone, duration } = body;

    if (!articleId) {
      return NextResponse.json(
        { error: "Article ID is required" },
        { status: 400 }
      );
    }

    const [article] = await db
      .select()
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.teamId, teamId)))
      .limit(1);

    if (!article) {
      return NextResponse.json(
        { error: "Article not found" },
        { status: 404 }
      );
    }

    // Atomically acquire generation lock — prevents concurrent double-debit
    // Sets podcastStatus='pending' only if NOT currently in flight
    const [locked] = await db
      .update(articles)
      .set({ podcastStatus: "pending" })
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.teamId, teamId),
          sql`(${articles.podcastStatus} IS NULL OR ${articles.podcastStatus} NOT IN ('pending', 'processing'))`
        )
      )
      .returning({ id: articles.id });

    if (!locked) {
      return NextResponse.json(
        { error: "Podcast generation already in progress", status: article.podcastStatus },
        { status: 409 }
      );
    }

    // Per-request idempotency key: stable for network retries, unique per generation attempt
    const requestKey = request.headers.get("X-Idempotency-Key") ?? crypto.randomUUID();

    // Debit AFTER acquiring lock — reset lock on insufficient credits
    const creditDebit = await debitCredits({
      teamId,
      userId,
      productType: "podcast",
      idempotencyKey: `podcast:${articleId}:${requestKey}`,
      sourceType: "article",
      sourceId: articleId,
    });

    if (!creditDebit.ok) {
      await db
        .update(articles)
        .set({ podcastStatus: article.podcastStatus ?? "none" })
        .where(eq(articles.id, articleId))
        .catch(() => {});
      return NextResponse.json(
        {
          error: "Insufficient credits",
          balance: creditDebit.balance,
          requiredCredits: creditDebit.requiredCredits,
          message: `You need ${creditDebit.requiredCredits} credits to generate a podcast. Current balance: ${creditDebit.balance}.`,
        },
        { status: 402 }
      );
    }

    // Fire-and-forget generation — worker handles async failure (sets podcastStatus=failed, refunds credits)
    try {
      generateArticlePodcast({
        articleId,
        tone,
        duration,
        teamId,
        userId,
        debitLedgerRowId: creditDebit.ledgerRowId,
      }).catch((err) => {
        console.error("Podcast generation failed:", err);
      });
    } catch (startErr) {
      await refundCredits({
        teamId,
        userId,
        amount: 8,
        reason: `Refund: podcast start failure for article ${articleId}`,
        sourceType: "article",
        sourceId: articleId,
        debitLedgerRowId: creditDebit.ledgerRowId,
      }).catch(() => {});
      throw startErr;
    }

    return NextResponse.json({
      success: true,
      message: "Podcast generation started",
      articleId,
      status: "pending",
    });
  } catch (error) {
    console.error("Error starting podcast generation:", error);
    return NextResponse.json(
      { error: "Failed to start podcast generation" },
      { status: 500 }
    );
  }
}
