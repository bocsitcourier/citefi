/**
 * POST /api/events/conversion
 * Unauthenticated, HMAC-SHA256 signature-gated conversion webhook.
 * External systems (e.g. CRM, checkout) POST here with:
 *   X-Apex-Signature: sha256=<HMAC-SHA256(teamSecret, rawBody)>
 *
 * Supports visitor-based attribution: if contentId is omitted but visitorId
 * is provided, the endpoint resolves contentId from the visitor's last event.
 *
 * GET /api/events/conversion  (requireTeamMember) — read total conversions
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentEvents, teams, articles, socialPosts } from "@/shared/schema";
import { eq, and, count, desc } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const conversionSchema = z.object({
  // teamId is optional when contentId is provided — the endpoint resolves it from the
  // content record. Callers that know their teamId should still send it to skip the
  // extra lookup. When neither teamId nor contentId is given, the request is rejected.
  teamId: z.number().int().positive().optional(),
  // contentId is optional — can be resolved via visitorId lookup or utmContent
  contentType: z.enum(["article", "social_post"]).optional(),
  contentId: z.number().int().positive().optional(),
  visitorId: z.string().max(100).optional(),
  conversionType: z.enum(["lead", "purchase", "signup", "download", "contact"]).optional(),
  value: z.number().min(0).optional(),
  journeyId: z.string().max(100).optional(),
  journeyStep: z.number().int().min(1).max(32767).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  utmContent: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

function verifyHmacSignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const expected = signatureHeader.startsWith("sha256=") ? signatureHeader : `sha256=${signatureHeader}`;
  const computed = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(computed));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = conversionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // ── Resolve contentId + contentType ─────────────────────────────────────
  // Supported payload patterns:
  //   { teamId, contentId }                    — direct (fastest path)
  //   { contentId }                            — teamId derived from content record
  //   { teamId, visitorId }                    — contentId derived from last visitor event
  //   { teamId, utmContent }                   — contentId derived from UTM-tagged event
  //   { contentId, contentType? }              — teamId auto-resolved, contentType optional

  let resolvedContentType = data.contentType; // may still be undefined at this point
  let resolvedContentId = data.contentId;
  let resolvedTeamId = data.teamId;

  // Step 1: If teamId is missing, resolve it from contentId (across both tables)
  if (!resolvedTeamId) {
    if (!resolvedContentId) {
      return NextResponse.json(
        { error: "Provide teamId or contentId to identify the team" },
        { status: 400 }
      );
    }
    // Try article first (most common), then social_post
    const contentTypesToTry = resolvedContentType
      ? [resolvedContentType]
      : (["article", "social_post"] as const);

    for (const ct of contentTypesToTry) {
      if (ct === "article") {
        const [article] = await db
          .select({ teamId: articles.teamId })
          .from(articles)
          .where(eq(articles.id, resolvedContentId))
          .limit(1);
        if (article) { resolvedTeamId = article.teamId; resolvedContentType = "article"; break; }
      } else {
        const [post] = await db
          .select({ teamId: socialPosts.teamId })
          .from(socialPosts)
          .where(eq(socialPosts.id, resolvedContentId))
          .limit(1);
        if (post) { resolvedTeamId = post.teamId; resolvedContentType = "social_post"; break; }
      }
    }

    if (!resolvedTeamId) {
      // Silent 204 — content not found; avoid leaking existence
      return new NextResponse(null, { status: 204 });
    }
  }

  // Step 2: Look up the team's HMAC secret (teamId is now resolved)
  const [teamRow] = await db
    .select({ id: teams.id, conversionWebhookSecret: teams.conversionWebhookSecret })
    .from(teams)
    .where(eq(teams.id, resolvedTeamId))
    .limit(1);

  if (!teamRow) {
    return new NextResponse(null, { status: 204 });
  }

  if (!teamRow.conversionWebhookSecret) {
    return NextResponse.json(
      { error: "Conversion webhook not configured for this team. Generate a secret via team settings." },
      { status: 403 }
    );
  }

  const signatureHeader = req.headers.get("x-apex-signature");
  if (!verifyHmacSignature(teamRow.conversionWebhookSecret, rawBody, signatureHeader)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Step 3: Resolve contentId via visitor attribution if still not known
  const effectiveContentType = resolvedContentType ?? "article";

  if (!resolvedContentId && data.visitorId) {
    const [lastEvent] = await db
      .select({
        contentType: contentEvents.contentType,
        articleId: contentEvents.articleId,
        socialPostId: contentEvents.socialPostId,
      })
      .from(contentEvents)
      .where(
        and(
          eq(contentEvents.teamId, resolvedTeamId),
          eq(contentEvents.visitorId, data.visitorId)
        )
      )
      .orderBy(desc(contentEvents.createdAt))
      .limit(1);

    if (lastEvent) {
      resolvedContentType = lastEvent.contentType as "article" | "social_post";
      resolvedContentId = (lastEvent.articleId ?? lastEvent.socialPostId) ?? undefined;
    }
  }

  // Step 4: Fallback — resolve via utmContent (CRM/checkout callbacks that only know UTM tag)
  if (!resolvedContentId && data.utmContent) {
    const [utmEvent] = await db
      .select({
        contentType: contentEvents.contentType,
        articleId: contentEvents.articleId,
        socialPostId: contentEvents.socialPostId,
      })
      .from(contentEvents)
      .where(
        and(
          eq(contentEvents.teamId, resolvedTeamId),
          eq(contentEvents.utmContent, data.utmContent)
        )
      )
      .orderBy(desc(contentEvents.createdAt))
      .limit(1);

    if (utmEvent) {
      resolvedContentType = utmEvent.contentType as "article" | "social_post";
      resolvedContentId = (utmEvent.articleId ?? utmEvent.socialPostId) ?? undefined;
    }
  }

  if (!resolvedContentId) {
    return NextResponse.json(
      { error: "Cannot resolve content: provide contentId, a visitorId with prior events, or a utmContent value matching tracked events" },
      { status: 422 }
    );
  }

  // Step 5: Verify resolved content belongs to the resolved team (anti-spoofing)
  const finalContentType = resolvedContentType ?? effectiveContentType;
  if (finalContentType === "article") {
    const [article] = await db
      .select({ teamId: articles.teamId })
      .from(articles)
      .where(eq(articles.id, resolvedContentId))
      .limit(1);
    if (!article || article.teamId !== resolvedTeamId) {
      return new NextResponse(null, { status: 204 });
    }
  } else {
    const [post] = await db
      .select({ teamId: socialPosts.teamId })
      .from(socialPosts)
      .where(eq(socialPosts.id, resolvedContentId))
      .limit(1);
    if (!post || post.teamId !== resolvedTeamId) {
      return new NextResponse(null, { status: 204 });
    }
  }

  const [row] = await db
    .insert(contentEvents)
    .values({
      teamId: resolvedTeamId,
      contentType: finalContentType,
      articleId: finalContentType === "article" ? resolvedContentId : null,
      socialPostId: finalContentType === "social_post" ? resolvedContentId : null,
      eventType: "conversion",
      visitorId: data.visitorId ?? null,
      conversionType: data.conversionType ?? null,
      conversionValue: data.value ?? null,
      journeyId: data.journeyId ?? null,
      journeyStep: data.journeyStep ?? null,
      utmSource: data.utmSource ?? null,
      utmMedium: data.utmMedium ?? null,
      utmCampaign: data.utmCampaign ?? null,
      utmContent: data.utmContent ?? null,
      metadata: data.metadata ?? null,
    })
    .returning({ id: contentEvents.id });

  console.log(`[conversion] teamId=${resolvedTeamId} contentId=${resolvedContentId} type=${data.conversionType ?? "—"} value=${data.value ?? "—"}`);

  return NextResponse.json({ ok: true, id: row.id });
}

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const url = new URL(req.url);
    const contentType = url.searchParams.get("contentType");
    const contentId = parseInt(url.searchParams.get("contentId") ?? "0");

    if (!contentId || (contentType !== "article" && contentType !== "social_post")) {
      return NextResponse.json({ error: "contentType and contentId required" }, { status: 400 });
    }

    const idCondition =
      contentType === "article"
        ? eq(contentEvents.articleId, contentId)
        : eq(contentEvents.socialPostId, contentId);

    const [result] = await db
      .select({ total: count() })
      .from(contentEvents)
      .where(and(eq(contentEvents.teamId, teamId), eq(contentEvents.eventType, "conversion"), idCondition));

    return NextResponse.json({ conversions: result?.total ?? 0 });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
    return NextResponse.json({ error: "Failed to fetch conversions" }, { status: err?.statusCode || 500 });
  }
}
