import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { buildSlugMap, injectLinksWithIntent, buildFallbackTerms } from "@/lib/slug-map-injector";
import { auditArticle } from "@/lib/guardian-agent";
import { applySurgicalFix } from "@/lib/surgical-fix";
import { isHighQualityAnchor, isHighQualityAnchorDeterministic } from "@/lib/seo-policy";
import * as cheerio from "cheerio";

/**
 * Strip all <a href> hyperlinks whose anchor text fails the quality gate
 * (bare geo anchors, single/double words, stop-word edges, etc.)
 * Returns the cleaned HTML and the count of links removed.
 */
function stripLowQualityLinks(html: string): { html: string; stripped: number } {
  let stripped = 0;
  // Match opening tag, inner content (may include nested tags), closing tag
  const cleaned = html.replace(/<a\s[^>]*href[^>]*>([\s\S]*?)<\/a>/gi, (match, inner) => {
    // Derive plain text from inner HTML for quality check
    const anchorText = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    // Use deterministic (3-word) gate so valid slug-map anchors are not stripped.
    if (!isHighQualityAnchorDeterministic(anchorText)) {
      stripped++;
      return inner; // unwrap — keep text, remove the <a> wrapper
    }
    return match; // keep as-is
  });
  return { html: cleaned, stripped };
}

// Stop-words whose presence at phrase edges kills SEO quality.
const STOP_WORDS_EDGE = new Set([
  "the","a","an","in","on","at","to","for","of","is","are","was","were",
  "and","or","but","this","that","these","those","it","its","we","our",
  "you","your","they","their","with","from","by","about","as","into",
  "how","what","when","where","which","who","why","be","been","being",
  "have","has","had","do","does","did","will","would","could","should",
  "may","might","must","shall","can","not","no","so","if","then","than",
  "also","more","most","any","all","each","both","few","many","some",
  "very","just","only","even","new","such","other","same",
]);

/**
 * Paragraph-level deterministic link top-up.
 *
 * Scans every <p> element for a 4-7 word phrase that contains at least one
 * hint word and passes isHighQualityAnchor. Injects an <a> link pointing at
 * targetUrl. Uses \s+ in the regex so it handles whitespace-collapsed phrases
 * that span multiple spaces or newlines in the raw HTML.
 *
 * Called when the slug-map injector produced fewer than 3 links — acts as a
 * reliable fallback that never times out and never calls an external API.
 */
function injectLinksTopUp(
  html: string,
  targetUrl: string,
  hintTerms: string[],
  needed: number
): { html: string; injected: number } {
  if (needed <= 0 || !html || !targetUrl) return { html, injected: 0 };

  const hintWords = new Set<string>();
  for (const term of hintTerms) {
    for (const w of term.toLowerCase().split(/\s+/)) {
      const clean = w.replace(/[^a-z]/g, "");
      if (clean.length > 3 && !STOP_WORDS_EDGE.has(clean)) hintWords.add(clean);
    }
  }

  const $ = cheerio.load(html, null, false);
  const safeUrl = targetUrl.replace(/"/g, "%22");
  const usedPhrases = new Set<string>();
  let injected = 0;

  $("p").each((_, el) => {
    if (injected >= needed) return false; // stop once we have enough

    const paragraphText = $(el).text().replace(/\s+/g, " ").trim();
    if (paragraphText.length < 40) return;

    // Find best 4-7 word phrase (longest first) containing a hint word
    const words = paragraphText.split(" ").filter((w) => w.length > 0);
    let chosenPhrase: string | null = null;

    outer: for (let len = 7; len >= 4; len--) {
      for (let i = 0; i <= words.length - len; i++) {
        const phraseWords = words.slice(i, i + len);
        const phrase = phraseWords.join(" ");
        const phraseLower = phrase.toLowerCase();

        if (usedPhrases.has(phraseLower)) continue;

        // Edge stop-word check
        const first = phraseWords[0]!.toLowerCase().replace(/[^a-z]/g, "");
        const last = phraseWords[phraseWords.length - 1]!.toLowerCase().replace(/[^a-z]/g, "");
        if (STOP_WORDS_EDGE.has(first) || STOP_WORDS_EDGE.has(last)) continue;

        // Must contain at least one hint word (relevance signal)
        if (
          hintWords.size > 0 &&
          !phraseWords.some((w) => hintWords.has(w.toLowerCase().replace(/[^a-z]/g, "")))
        ) continue;

        if (!isHighQualityAnchor(phrase)) continue;

        chosenPhrase = phrase;
        break outer;
      }
    }

    if (!chosenPhrase) return;

    const innerHtml = $(el).html() || "";
    // Build regex that tolerates whitespace variation between words (including
    // newlines or multiple spaces that survive from the original HTML).
    const escapedWords = chosenPhrase
      .split(" ")
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = escapedWords.join("\\s+");
    const rx = new RegExp(`(?<![a-zA-Z])(${pattern})(?![a-zA-Z])`, "i");

    const match = rx.exec(innerHtml);
    if (!match) return;

    const newHtml = innerHtml.replace(
      rx,
      (fullMatch) =>
        `<a href="${safeUrl}" class="text-primary hover:underline" rel="noopener noreferrer">${fullMatch}</a>`
    );

    if (newHtml !== innerHtml) {
      $(el).html(newHtml);
      usedPhrases.add(chosenPhrase.toLowerCase());
      injected++;
    }
  });

  return { html: $.html(), injected };
}

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

    // PRE-STRIP: remove existing low-quality hyperlinks (bare geo, <4 words, etc.)
    // so the injection pass gets a clean slate to inject proper 4-7 word anchors.
    const { html: strippedHtml, stripped: strippedCount } = stripLowQualityLinks(healedHtml);
    if (strippedCount > 0) {
      console.log(`🧹 Heal pre-strip: removed ${strippedCount} low-quality link(s) from article ${articleId}`);
      healedHtml = strippedHtml;
    }

    // Build hint terms once — reused by both slug-map injection and the top-up.
    const fallbackTerms = buildFallbackTerms({
      coreTopic: batch?.coreTopic,
      geographicFocus,
      businessName: batch?.businessName,
      geminiKeywords: Array.isArray(article.keywordsJson) ? (article.keywordsJson as string[]) : [],
    });

    if (targetUrl && targetUrl.match(/^https?:\/\//i)) {
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

      // Always update healedHtml — the injection pass also applies the pre-strip
      // and may reorganise existing links even when net count is unchanged.
      healedHtml = injection.html;
      console.log(`🔗 Heal pass 1 (links): article ${articleId} — +${linksInjected} links via ${linkMode}`);

      // ── PASS 1b: PARAGRAPH-LEVEL TOP-UP ──────────────────────────────────────
      // If slug-map injection yielded fewer than 3 links, fall back to a
      // deterministic paragraph-level scan that tolerates inline HTML element
      // splits and whitespace variation (no external API calls — never times out).
      const minLinks = 3;
      if (linksInjected < minLinks) {
        const needed = minLinks - linksInjected;
        const { html: toppedUpHtml, injected: topUpCount } = injectLinksTopUp(
          healedHtml,
          targetUrl,
          fallbackTerms,
          needed + 2 // inject a few extras to give guardian a comfortable margin
        );
        if (topUpCount > 0) {
          healedHtml = toppedUpHtml;
          linksInjected += topUpCount;
          linkMode = "topup";
          console.log(`🔗 Heal pass 1b (top-up): article ${articleId} — +${topUpCount} paragraph-level links (total: ${linksInjected})`);
        }
      }
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
        // Separate link issues (deterministic) from structural issues (need GPT).
        const structuralIssues = allIssues.filter((i) => !i.includes("MISSING_HYPERLINKS"));
        const linkIssueOnly = allIssues.every((i) => i.includes("MISSING_HYPERLINKS"));

        if (linkIssueOnly && targetUrl && targetUrl.match(/^https?:\/\//i)) {
          // MISSING_HYPERLINKS is a deterministic problem — skip GPT timeout risk.
          // Use the paragraph-level top-up to inject remaining links instantly.
          console.log(`🔗 Heal pass 3 (link top-up bypass): deterministic top-up instead of GPT for article ${articleId}`);
          const { html: topUpHtml, injected: topUpCount } = injectLinksTopUp(
            healedHtml,
            targetUrl,
            fallbackTerms,
            3 // ensure we reach the 3-link minimum
          );
          if (topUpCount > 0) {
            healedHtml = topUpHtml;
            linksInjected += topUpCount;
            surgicalFixApplied = true;
            surgicalFixes = [`MISSING_HYPERLINKS (+${topUpCount} deterministic)`];
            console.log(`✅ Link top-up applied for article ${articleId}: +${topUpCount} links`);
          }
        } else {
          // Structural issues (FAQ, images, formatting) — these require GPT-4.
          const issuesForGpt = structuralIssues.length > 0 ? structuralIssues : allIssues;
          console.log(`🔧 Heal pass 3 (surgical fix): fixing [${issuesForGpt.join(", ")}] in article ${articleId}`);

          const fix = await applySurgicalFix({
            html: healedHtml,
            missingElements: missingElements.filter((i) => !i.includes("MISSING_HYPERLINKS") || !linkIssueOnly),
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

            // After GPT structural fix, also run a link top-up if links still missing.
            if (
              missingElements.some((i) => i.includes("MISSING_HYPERLINKS")) &&
              targetUrl && targetUrl.match(/^https?:\/\//i)
            ) {
              const { html: finalHtml, injected: finalTopUp } = injectLinksTopUp(
                healedHtml,
                targetUrl,
                fallbackTerms,
                3
              );
              if (finalTopUp > 0) {
                healedHtml = finalHtml;
                linksInjected += finalTopUp;
                surgicalFixes.push(`MISSING_HYPERLINKS (+${finalTopUp} deterministic)`);
              }
            }
          }
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
    if (strippedCount > 0) parts.push(`${strippedCount} low-quality link(s) removed`);
    if (linksInjected > 0) parts.push(`${linksInjected} quality hyperlinks added`);
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
    const statusCode = (error as any)?.statusCode ?? 500;
    return NextResponse.json(
      {
        error: "Failed to heal article",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: statusCode }
    );
  }
}
