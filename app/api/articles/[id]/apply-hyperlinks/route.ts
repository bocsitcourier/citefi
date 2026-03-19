import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { buildSlugMap, injectLinksWithIntent, buildFallbackTerms } from "@/lib/slug-map-injector";
import { auditArticle } from "@/lib/guardian-agent";
import { applySurgicalFix } from "@/lib/surgical-fix";

/**
 * POST /api/articles/[id]/apply-hyperlinks
 *
 * "Platinum Heal" — multi-pass repair endpoint:
 *
 *   Pass 1 — Hyperlink Injection
 *     Content-first or site-map intent-driven link injection.
 *
 *   Pass 2 — Guardian Audit
 *     Checks for missing images, FAQ section, word count, raw markdown.
 *
 *   Pass 3 — Surgical Fix (if Guardian fails)
 *     GPT-4 injects only the missing structural elements (never rewrites content).
 *
 *   Single DB write at the end — no ghost save possible.
 *
 * geographicFocus is read from batch.generationParams (JSONB) — NOT from a
 * direct column — to avoid the "JSONB ghost" silent-undefined bug.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    const articleId = parseInt(id);

    if (isNaN(articleId)) {
      return NextResponse.json({ error: "Invalid article ID" }, { status: 400 });
    }

    // Fetch article — enforce team ownership
    const [article] = await db
      .select()
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.teamId, teamId)));

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    if (!article.finalHtmlContent) {
      return NextResponse.json(
        { error: "Article has no HTML content — generate the article first" },
        { status: 422 }
      );
    }

    // Fetch batch
    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(eq(jobBatches.id, article.batchId!));

    const targetUrl = batch?.targetUrl;
    const batchParams = (batch?.generationParams as Record<string, any>) ?? {};
    const geographicFocus: string | undefined = batchParams.geographicFocus;
    const businessName = batch?.businessName ?? undefined;
    const tone = batchParams.tone as string | undefined;

    // ── PASS 1: HYPERLINK INJECTION ────────────────────────────────────────────
    let healedHtml = article.finalHtmlContent;
    let linksInjected = 0;
    let linkMode = "skipped";
    let linkedKeywords: string[] = [];

    if (targetUrl && targetUrl.match(/^https?:\/\//i)) {
      const fallbackTerms = buildFallbackTerms({
        coreTopic: batch?.coreTopic,
        geographicFocus,
        businessName: batch?.businessName,
        geminiKeywords: Array.isArray(article.keywordsJson) ? (article.keywordsJson as string[]) : [],
      });

      const { entries, pages } = await buildSlugMap(teamId, targetUrl, fallbackTerms);
      const anchorsBefore = (healedHtml.match(/<a /gi) || []).length;

      const injection = await injectLinksWithIntent(
        healedHtml,
        entries,
        pages,
        targetUrl,
        article.chosenTitle || `article ${articleId}`,
        fallbackTerms
      );

      const anchorsAfter = (injection.html.match(/<a /gi) || []).length;
      linksInjected = anchorsAfter - anchorsBefore;
      linkMode = injection.mode;
      linkedKeywords = injection.linkedKeywords;

      if (injection.linksInjected > 0 || linksInjected > 0) {
        healedHtml = injection.html;
      }
      console.log(`🔗 Heal pass 1 (links): article ${articleId} — +${linksInjected} links via ${linkMode}`);
    } else {
      console.warn(`⚠️ Heal: no valid targetUrl for article ${articleId} — skipping link injection`);
    }

    // ── PASS 2: GUARDIAN AUDIT ─────────────────────────────────────────────────
    let guardianScore = 100;
    let guardianPassed = true;
    let missingElements: string[] = [];
    let formattingIssues: string[] = [];
    let surgicalFixApplied = false;
    let surgicalFixes: string[] = [];

    try {
      const audit = await auditArticle(healedHtml, {
        minImages: 1,
        minHyperlinks: 3,
        minFaqQuestions: 2,
        minWordCount: 600,
        skipToneCheck: true, // skip expensive tone check during heal
        businessName: businessName || "",
        persona: tone || "professional",
      });

      guardianScore = audit.score;
      guardianPassed = audit.passed;
      missingElements = audit.missingElements || [];
      formattingIssues = audit.formattingIssues || [];

      console.log(`🛡️ Heal pass 2 (guardian): article ${articleId} — score=${guardianScore}, passed=${guardianPassed}`);

      // ── PASS 3: SURGICAL FIX ────────────────────────────────────────────────
      const allIssues = [...missingElements, ...formattingIssues];
      if (!guardianPassed && allIssues.length > 0) {
        console.log(`🔧 Heal pass 3 (surgical fix): fixing [${allIssues.join(", ")}] in article ${articleId}`);

        const fix = await applySurgicalFix({
          html: healedHtml,
          missingElements,
          formattingIssues,
          businessName: businessName || undefined,
          persona: tone || "professional",
          targetUrl: targetUrl || undefined,
          keywords: Array.isArray(article.keywordsJson) ? (article.keywordsJson as string[]) : [],
          geographicFocus: geographicFocus || undefined,
        });

        if (!fix.unchanged) {
          healedHtml = fix.html;
          surgicalFixApplied = true;
          surgicalFixes = fix.appliedFixes;
          console.log(`✅ Surgical fix applied for article ${articleId}: ${surgicalFixes.join(", ")}`);
        }
      }
    } catch (guardianErr) {
      console.warn(`⚠️ Guardian/Surgical step failed for article ${articleId} (non-blocking):`, guardianErr);
    }

    // ── SINGLE DB WRITE ────────────────────────────────────────────────────────
    await db
      .update(articles)
      .set({ finalHtmlContent: healedHtml })
      .where(eq(articles.id, articleId));

    // Build human-readable summary
    const parts: string[] = [];
    if (linksInjected > 0) parts.push(`${linksInjected} hyperlinks added`);
    if (surgicalFixApplied) parts.push(`structural fixes: ${surgicalFixes.join(", ")}`);
    if (parts.length === 0 && guardianPassed) parts.push("article already meets quality standards");
    if (parts.length === 0) parts.push("no improvements could be applied");

    return NextResponse.json({
      success: true,
      message: `Heal complete — ${parts.join("; ")}`,
      articleId,
      passes: {
        links: {
          injected: linksInjected,
          mode: linkMode,
          keywords: linkedKeywords,
        },
        guardian: {
          score: guardianScore,
          passed: guardianPassed,
          missing: missingElements,
          formatting: formattingIssues,
        },
        surgical: {
          applied: surgicalFixApplied,
          fixes: surgicalFixes,
        },
      },
    });

  } catch (error) {
    console.error("❌ Heal error:", error);
    return NextResponse.json(
      {
        error: "Failed to heal article",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
