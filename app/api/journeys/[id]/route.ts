import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { journeys, journeySteps, articles, socialPosts } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const updateJourneySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: z.enum(["draft", "active", "completed", "paused"]).optional(),
  locale: z.string().max(20).nullable().optional(),
  localeConfig: z.record(z.unknown()).nullable().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { teamId } = await requireTeamMember(req);
    const journeyId = parseInt(params.id);
    if (isNaN(journeyId)) return NextResponse.json({ error: "Invalid journey id" }, { status: 400 });

    const [journey] = await db
      .select()
      .from(journeys)
      .where(and(eq(journeys.id, journeyId), eq(journeys.teamId, teamId)))
      .limit(1);

    if (!journey) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

    const steps = await db
      .select()
      .from(journeySteps)
      .where(eq(journeySteps.journeyId, journeyId))
      .orderBy(journeySteps.stepIndex);

    // Enrich steps with generated content previews
    const enrichedSteps = await Promise.all(
      steps.map(async (step) => {
        let contentPreview: {
          title?: string;
          slug?: string;
          wordCount?: number;
          url?: string;
          text?: string;
          podcastStatus?: string;
          podcastUrl?: string;
          videoStatus?: string;
          videoUrl?: string;
        } | null = null;

        try {
          if (step.contentType === "article" && step.articleId) {
            const [art] = await db
              .select({ chosenTitle: articles.chosenTitle, slug: articles.slug, wordCount: articles.wordCount })
              .from(articles)
              .where(and(eq(articles.id, step.articleId), eq(articles.teamId, teamId)))
              .limit(1);
            if (art) {
              contentPreview = {
                title: art.chosenTitle ?? undefined,
                slug: art.slug ?? undefined,
                wordCount: art.wordCount ?? undefined,
                url: art.slug ? `/content/${step.articleId}` : undefined,
              };
            }
          } else if (step.contentType === "social" && step.articleId) {
            const [post] = await db
              .select({ topic: socialPosts.topic, title: socialPosts.title, status: socialPosts.status })
              .from(socialPosts)
              .where(and(eq(socialPosts.id, step.articleId), eq(socialPosts.teamId, teamId)))
              .limit(1);
            if (post) {
              contentPreview = {
                title: post.title,
                text: post.topic,
              };
            }
          } else if (step.contentType === "podcast" && step.articleId) {
            const [art] = await db
              .select({ chosenTitle: articles.chosenTitle, podcastStatus: articles.podcastStatus, podcastUrl: articles.podcastUrl })
              .from(articles)
              .where(and(eq(articles.id, step.articleId), eq(articles.teamId, teamId)))
              .limit(1);
            if (art) {
              contentPreview = {
                title: art.chosenTitle ?? undefined,
                podcastStatus: art.podcastStatus ?? undefined,
                podcastUrl: art.podcastUrl ?? undefined,
              };
            }
          } else if (step.contentType === "video" && step.articleId) {
            const [post] = await db
              .select({ title: socialPosts.title, videoStatus: socialPosts.videoStatus, videoUrl: socialPosts.videoUrl })
              .from(socialPosts)
              .where(and(eq(socialPosts.id, step.articleId), eq(socialPosts.teamId, teamId)))
              .limit(1);
            if (post) {
              contentPreview = {
                title: post.title,
                videoStatus: post.videoStatus ?? undefined,
                videoUrl: post.videoUrl ?? undefined,
              };
            }
          }
        } catch {
          // Content preview is best-effort — never fail the response
        }

        return { ...step, contentPreview };
      })
    );

    return NextResponse.json({ journey, steps: enrichedSteps });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403)
      return NextResponse.json({ error: err.message }, { status });
    console.error("[journeys/[id] GET]", err);
    return NextResponse.json({ error: "Failed to fetch journey" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { teamId } = await requireTeamMember(req);
    const journeyId = parseInt(params.id);
    if (isNaN(journeyId)) return NextResponse.json({ error: "Invalid journey id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const parsed = updateJourneySchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });

    const existing = await db
      .select({ id: journeys.id })
      .from(journeys)
      .where(and(eq(journeys.id, journeyId), eq(journeys.teamId, teamId)))
      .limit(1);

    if (existing.length === 0) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

    const [updated] = await db
      .update(journeys)
      .set(parsed.data)
      .where(and(eq(journeys.id, journeyId), eq(journeys.teamId, teamId)))
      .returning();

    return NextResponse.json({ journey: updated });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403)
      return NextResponse.json({ error: err.message }, { status });
    console.error("[journeys/[id] PATCH]", err);
    return NextResponse.json({ error: "Failed to update journey" }, { status: 500 });
  }
}
