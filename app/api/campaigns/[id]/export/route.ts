import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { PassThrough } from "stream";
import { requireTeamMember } from "@/lib/api/auth";
import {
  getCampaignByPublicId,
  loadCampaignExportContent,
  recordCampaignExport,
} from "@/lib/campaign-service";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/campaigns/[id]/export — produce a ZIP bundling all campaign
 * articles/social/video plus a metadata manifest, and record a campaign_exports
 * row idempotently. Public UUID, tenant-safe.
 *
 * Idempotency: pass X-Idempotency-Key to make the audit record dedupe across
 * retried downloads. The ZIP is always regenerated (streamed content), but only
 * one export audit row is written per key.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId, userId } = await requireTeamMember(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const campaign = await getCampaignByPublicId(teamId, id);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const content = await loadCampaignExportContent(teamId, campaign.id);
    if (!content) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const { articles: campaignArticles, socialPosts: campaignSocial, videos: campaignVideos } =
      content;

    const totalItems =
      campaignArticles.length + campaignSocial.length + campaignVideos.length;
    if (totalItems === 0) {
      return NextResponse.json(
        { error: "No content found in this campaign" },
        { status: 404 }
      );
    }

    const archive = archiver("zip", { zlib: { level: 9 } });
    const passThrough = new PassThrough();
    archive.pipe(passThrough);
    archive.on("error", (err) => {
      console.error("Campaign archive error:", err);
      passThrough.destroy(err);
    });

    // ── Manifest ──────────────────────────────────────────────────────────
    const manifest = {
      campaign: {
        publicId: campaign.publicId,
        name: campaign.name,
        businessUrl: campaign.businessUrl,
        companyName: campaign.companyName,
        status: campaign.status,
        goals: campaign.goals ?? [],
        locations: campaign.locations ?? [],
        assetBundle: campaign.assetBundle ?? null,
        brandStatus: campaign.brandStatus ?? null,
        brandConfirmedAt: campaign.brandConfirmedAt ?? null,
        createdAt: campaign.createdAt,
      },
      counts: {
        articles: campaignArticles.length,
        socialPosts: campaignSocial.length,
        videos: campaignVideos.length,
      },
      exportedAt: new Date().toISOString(),
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: "campaign.json" });

    // ── Articles ──────────────────────────────────────────────────────────
    archive.append(generateArticleCsv(campaignArticles), {
      name: "articles/metadata.csv",
    });
    for (const article of campaignArticles) {
      if (article.finalHtmlContent) {
        const slug = article.slug || `article-${article.id}`;
        archive.append(article.finalHtmlContent, {
          name: `articles/html/${slug}.html`,
        });
        archive.append(htmlToMarkdown(article.finalHtmlContent), {
          name: `articles/markdown/${slug}.md`,
        });
      }
    }

    // ── Social posts ──────────────────────────────────────────────────────
    if (campaignSocial.length > 0) {
      archive.append(
        JSON.stringify(
          campaignSocial.map((s) => ({
            publicId: s.publicId,
            topic: s.topic,
            title: s.title,
            location: s.location,
            platforms: s.platformsJson ?? [],
            status: s.status,
            videoUrl: s.videoUrl ?? null,
            createdAt: s.createdAt,
          })),
          null,
          2
        ),
        { name: "social/social-posts.json" }
      );
    }

    // ── Videos ────────────────────────────────────────────────────────────
    if (campaignVideos.length > 0) {
      archive.append(
        JSON.stringify(
          campaignVideos.map((v) => ({
            publicId: v.publicId,
            ideaTitle: v.ideaTitle,
            shortIdea: v.shortIdea,
            status: v.status,
            videoUrl: v.videoUrl ?? null,
            thumbnailUrl: v.thumbnailUrl ?? null,
            createdAt: v.createdAt,
          })),
          null,
          2
        ),
        { name: "video/video-ideas.json" }
      );
    }

    archive.finalize();

    // ── Idempotent audit record ───────────────────────────────────────────
    // Reuse a caller-supplied idempotency key so retried downloads dedupe; else
    // fall back to a per-request key derived from the campaign + timestamp.
    const requestKey =
      request.headers.get("X-Idempotency-Key") ??
      `campaign:${campaign.id}:${Date.now()}`;
    await recordCampaignExport(teamId, campaign.id, {
      requestedBy: userId,
      requestKey,
      kind: "zip",
      status: "ready",
      filters: manifest.counts,
    }).catch((err) =>
      console.warn("[campaign-export] failed to record export:", err)
    );

    return new NextResponse(passThrough as any, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="campaign-${campaign.publicId}-export.zip"`,
      },
    });
  } catch (err: any) {
    if (err.statusCode)
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    console.error("GET /api/campaigns/[id]/export error:", err);
    return NextResponse.json(
      {
        error: "Failed to export campaign",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      { status: err?.statusCode || 500 }
    );
  }
}

function generateArticleCsv(rows: any[]): string {
  const headers = [
    "ID",
    "Title",
    "SEO Title",
    "Slug",
    "Word Count",
    "Status",
    "Created At",
    "Updated At",
  ];
  const csvRows = rows.map((a) => [
    a.id,
    `"${(a.chosenTitle || "").replace(/"/g, '""')}"`,
    `"${(a.seoTitle || "").replace(/"/g, '""')}"`,
    a.slug || "",
    a.wordCount || 0,
    a.articleStatus,
    a.createdAt,
    a.updatedAt,
  ]);
  return [headers.join(","), ...csvRows.map((r) => r.join(","))].join("\n");
}

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, "![$2]($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}
