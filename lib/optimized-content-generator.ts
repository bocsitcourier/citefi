/**
 * OptimizedContentGenerator
 * =========================
 * The keystone orchestrator that makes the AI Learning Center a CLOSED LOOP.
 *
 * Three injection points:
 *  1. PRE  — assemble prompt with Wilson-ranked patterns + exemplars + avoid-list
 *  2. DURING — critic-in-the-loop: review immediately after generation; repair
 *             bounded defects up to MAX_REPAIRS passes; flag factuality rather
 *             than blindly re-rolling it
 *  3. POST — record EXACTLY which pattern IDs were injected so the engagement
 *             labeler + review attribution can credit/blame the right patterns
 *
 * Workers call reviewAndRepairContent() to plug the critic loop into an
 * already-running pipeline (e.g. after Stage 1 Gemini, before Stage 2 GPT).
 *
 * CONTRACT: injectedPatterns assembled in step 1 MUST equal IDs recorded in
 * step 3. Breaking this identity makes injection open-loop.
 */

import { GoogleGenAI } from "@google/genai";
import { learningService } from "./learning-service";
import { contentReviewService } from "./content-review-service";
import { GEMINI_FLASH_MODEL, GPT_ENHANCEMENT_MODEL } from "./ai-config";
import { callOpenAI } from "./openai-client";
import { db } from "./db";
import {
  articles,
  socialPostVariants,
  clientBrandProfiles,
  contentPerformanceMetrics,
  ContentType,
} from "../shared/schema";
import { eq, and, gte, desc } from "drizzle-orm";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ── Defects the agent can repair by REVISING ──────────────────────────────────
// Factuality defects are NOT here — re-asking a model to "fix" a hallucination
// often just hallucinates again; those are flagged for human review instead.
const REPAIRABLE = new Set<string>([
  "completeness:truncated",
  "completeness:missing_section",
  "completeness:thin_section",
  "completeness:unanswered_brief",
  "structure:no_answer_first",
  "structure:bad_headings",
  "structure:missing_faq",
  "structure:missing_schema",
  "humanness:ai_isms",
  "humanness:low_burstiness",
  "humanness:repetitive_openings",
  "channel:weak_hook",
  "channel:no_cta",
  "channel:no_pacing_markers",
]);

const MAX_REPAIRS = 2;           // bound critic-in-the-loop (cost control)
const MAX_INJECTED_PATTERNS = 8; // cap prompt injection — more dilutes & conflicts
const EXEMPLAR_MAX_CHARS = 600;  // trim excerpts to keep prompts lean

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Brief {
  topic: string;
  location?: string;
  keyword?: string;
  targetWords?: number;
  questions?: string[];
  /** Pre-allocated DB id — required when using reviewAndRepairContent */
  contentId?: number;
}

export interface RepairResult {
  content: string;
  repairs: number;
  qualityScore: number;
  status: "ready" | "needs_human";
  review: Awaited<ReturnType<typeof contentReviewService.reviewContent>>;
}

export interface GenResult extends RepairResult {
  patternsInjected: number[];
  metricId: number;
}

// ── Defect-to-instruction map ─────────────────────────────────────────────────

const DEFECT_INSTRUCTIONS: Record<string, string> = {
  "completeness:truncated":
    "The content is cut off — complete the final section properly.",
  "completeness:missing_section":
    "A required section is missing — add it.",
  "completeness:thin_section":
    "Some sections are too thin — expand them to substantive depth.",
  "completeness:unanswered_brief":
    "An assigned question wasn't answered — answer it thoroughly.",
  "structure:no_answer_first":
    "Open with a direct answer containing the keyword in the first 80 words.",
  "structure:bad_headings":
    "Add descriptive H2/H3 headings that guide the reader.",
  "structure:missing_faq":
    "Add an FAQ section with 6-8 natural questions.",
  "structure:missing_schema":
    "Add JSON-LD structured data at the end.",
  "humanness:ai_isms":
    "Remove AI-isms (leverage, dive into, in today's world, it's worth noting).",
  "humanness:low_burstiness":
    "Vary sentence length — mix short punchy lines with longer analytical ones.",
  "humanness:repetitive_openings":
    "Vary how sentences begin; avoid repeated openers like 'Additionally' or 'Furthermore'.",
  "channel:weak_hook":
    "Strengthen the opening hook so it grabs attention in the first 3 seconds.",
  "channel:no_cta":
    "Add a clear, natural call to action.",
  "channel:no_pacing_markers":
    "Add visual pacing markers (bold phrases, short paragraphs, subheadings) for mobile reading.",
};

// ─────────────────────────────────────────────────────────────────────────────

export class OptimizedContentGenerator {
  private static instance: OptimizedContentGenerator;

  static getInstance(): OptimizedContentGenerator {
    if (!this.instance) this.instance = new OptimizedContentGenerator();
    return this.instance;
  }

  // ==========================================================================
  // PRIMARY API for EXISTING WORKERS
  // Call this AFTER your main generation step, BEFORE GPT enhancement.
  // Runs the full critic-in-the-loop repair cycle on already-generated
  // content and writes the Wilson attribution to pattern_dimension_stats.
  //
  // opts.requireJudge — force a final GPT-4o-mini judge pass even when
  //   the content has zero defects (auto-set by the orchestrator for
  //   ARTICLE/SOCIAL; default false for PODCAST/VIDEO).
  // opts.brandContext — brand policy prompt block from ClientBrandProfile;
  //   injected into every repair call to prevent policy drift under revision.
  // ==========================================================================
  async reviewAndRepairContent(
    teamId: number,
    contentType: string,
    contentId: number,
    content: string,
    patternsUsed: number[],
    brief: Partial<Brief> = {},
    opts: { requireJudge?: boolean; brandContext?: string } = {}
  ): Promise<RepairResult> {
    const fullBrief: Brief = { topic: brief.topic ?? contentType, contentId, ...brief };

    // ── INJECTION POINT 2: DURING — critic-in-the-loop ───────────────────────
    let currentContent = content;
    let review = await contentReviewService.reviewContent(
      teamId,
      contentId,
      contentType,
      currentContent,
      fullBrief,
      { useJudge: false } // fast pass first; save judge cost for final
    );

    let repairs = 0;
    let judgeRan = false;

    while (!review.passed && repairs < MAX_REPAIRS) {
      const fixable = review.defects.filter((d) => REPAIRABLE.has(d.code));
      const factual = review.defects.filter((d) => d.dim === "factuality");

      if (factual.length > 0) {
        currentContent = this.handleFactuality(currentContent, factual);
      }
      if (fixable.length === 0) break;

      currentContent = await this.repair(
        currentContent,
        fixable,
        fullBrief,
        { model: GEMINI_FLASH_MODEL, temperature: 0.3 },
        opts.brandContext
      );

      // Use judge on final pass only (cost control) — also fires when few defects remain
      const useJudge = repairs + 1 >= MAX_REPAIRS || fixable.length <= 2;
      review = await contentReviewService.reviewContent(
        teamId,
        contentId,
        contentType,
        currentContent,
        fullBrief,
        { useJudge }
      );
      if (useJudge) judgeRan = true;
      repairs++;
      console.log(
        `🔧 Critic repair pass ${repairs}/${MAX_REPAIRS}: ${fixable.length} defects addressed → passed=${review.passed}`
      );
    }

    // Force a final judge pass when requireJudge=true and it hasn't run yet.
    // This ensures quality scoring fires for ARTICLE/SOCIAL even on clean content.
    if (opts.requireJudge && !judgeRan) {
      review = await contentReviewService.reviewContent(
        teamId,
        contentId,
        contentType,
        currentContent,
        fullBrief,
        { useJudge: true }
      );
      judgeRan = true;
      console.log(
        `🔬 Final judge pass (${contentType} ${contentId}): quality=${this.computeQualityScore(review.dimensionScores)}`
      );
    }

    const qualityScore = this.computeQualityScore(review.dimensionScores);
    const status: RepairResult["status"] = review.passed ? "ready" : "needs_human";

    if (repairs > 0) {
      console.log(
        `✅ Critic loop done for ${contentType} ${contentId}: ${repairs} repair(s), quality=${qualityScore}, status=${status}`
      );
    }

    return { content: currentContent, repairs, qualityScore, status, review };
  }

  // ==========================================================================
  // FULL ORCHESTRATION — generate() closes ALL three injection points.
  // ==========================================================================
  async generate(
    teamId: number,
    contentType: string,
    brief: Brief
  ): Promise<GenResult> {
    // ── INJECTION POINT 1: PRE — assemble everything the agent has learned ───
    const ctx = await learningService.getOptimizationContext(teamId, contentType, {});
    if (!ctx) throw new Error(`No learning agent for ${contentType}`);

    const injectedPatterns = ctx.patterns.slice(0, MAX_INJECTED_PATTERNS);
    const exemplars = await this.retrieveExemplars(teamId, contentType, brief);
    const prompt = this.assemblePrompt(
      brief,
      ctx.promptEnhancements ?? [],
      injectedPatterns,
      exemplars
    );

    let content = await this.callModel(
      ctx.modelConfig?.model ?? GEMINI_FLASH_MODEL,
      prompt,
      ctx.modelConfig?.temperature ?? 0.7
    );

    // ── INJECTION POINT 2: DURING — critic-in-the-loop ───────────────────────
    const repairResult = await this.reviewAndRepairContent(
      teamId,
      contentType,
      0,
      content,
      injectedPatterns.map((p) => p.id),
      brief
    );
    content = repairResult.content;

    // ── INJECTION POINT 3: POST — persist + record exact patterns used ────────
    const contentId = await this.persistContent(teamId, contentType, brief, content);

    const metricId = await learningService.recordContentGeneration(
      teamId,
      ctx.agentId,
      contentType,
      contentId,
      injectedPatterns.map((p) => p.id),
      repairResult.qualityScore
    );

    console.log(
      `✅ Generated ${contentType} (${repairResult.status}) — quality ${repairResult.qualityScore}, ${repairResult.repairs} repair(s)`
    );

    return {
      ...repairResult,
      patternsInjected: injectedPatterns.map((p) => p.id),
      metricId,
    };
  }

  // ==========================================================================
  // PROMPT ASSEMBLY
  // ==========================================================================
  private assemblePrompt(
    brief: Brief,
    enhancements: string[],
    patterns: { patternType: string; patternName: string; patternValue: string }[],
    exemplars: string[]
  ): string {
    const learned = enhancements.length
      ? `LEARNED GUIDANCE (apply these — ranked by proven performance):\n${enhancements.join("\n")}`
      : "";

    const playbook = patterns.length
      ? `PROVEN TACTICS:\n${patterns.map((p) => `• [${p.patternType}] ${p.patternValue}`).join("\n")}`
      : "";

    const examples = exemplars.length
      ? `EXAMPLES OF YOUR BEST PAST WORK (match quality & voice, don't copy):\n${exemplars
          .map((ex, i) => `--- Example ${i + 1} ---\n${ex}`)
          .join("\n\n")}`
      : "";

    return [
      `Write a ${brief.targetWords ?? 2000}-word piece.`,
      `TOPIC: ${brief.topic}`,
      brief.location ? `LOCATION: ${brief.location}` : "",
      brief.keyword ? `PRIMARY KEYWORD: ${brief.keyword}` : "",
      brief.questions?.length
        ? `MUST ANSWER:\n${brief.questions.map((q) => `- ${q}`).join("\n")}`
        : "",
      "",
      learned,
      "",
      playbook,
      "",
      examples,
      "",
      "Output clean semantic HTML. Finish every section.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // ==========================================================================
  // REPAIR — targeted revision for the specific defects found.
  // brandContext (from ClientBrandProfile) is injected when provided so the
  // model cannot accidentally weaken brand policy during a structural fix.
  // ==========================================================================
  private async repair(
    content: string,
    defects: { code: string; evidence: string }[],
    brief: Brief,
    modelConfig: { model: string; temperature: number },
    brandContext?: string
  ): Promise<string> {
    const instructions = defects
      .map((d) => {
        const base = DEFECT_INSTRUCTIONS[d.code] ?? d.code;
        const detail = d.evidence ? ` (${d.evidence})` : "";
        return `- ${base}${detail}`;
      })
      .join("\n");

    const brandBlock = brandContext
      ? `\nBRAND POLICY (enforce throughout — do not weaken or remove during revision):\n${brandContext}\n`
      : "";

    const prompt = [
      "Revise the following content. Fix ONLY these issues, keep everything else intact:",
      instructions,
      brief.location ? `Content is for: ${brief.location}` : "",
      brandBlock,
      "",
      "CONTENT:",
      content,
      "",
      "Return the full corrected HTML.",
    ]
      .filter(Boolean)
      .join("\n");

    return this.callModel(
      modelConfig.model,
      prompt,
      Math.max(0.2, modelConfig.temperature - 0.2)
    );
  }

  // Strip/flag unsupported claims rather than blindly regenerating them.
  private handleFactuality(
    content: string,
    factual: { evidence: string }[]
  ): string {
    let out = content;
    for (const f of factual) {
      if (f.evidence && f.evidence.length > 0) {
        out = out.replace(
          f.evidence,
          `<mark data-unverified="true">${f.evidence}</mark>`
        );
      }
    }
    console.warn(
      `⚠️ ${factual.length} unverifiable claim(s) flagged for human review`
    );
    return out;
  }

  // ==========================================================================
  // EXEMPLAR RETRIEVAL — real past winners for this team + content type.
  //
  // Priority order:
  //  1. Historical: content_performance_metrics where isSuccess=1 AND qualityScore>=80
  //     for the same team + contentType, joined to the actual content text.
  //  2. Seed: clientBrandProfiles.manualOverridesJson.seedExemplars (manually curated).
  //  3. None: return [] — orchestrator continues without exemplar injection.
  //
  // Logs EXEMPLAR_SOURCE: historical|seed|none for observability.
  // ==========================================================================
  private async retrieveExemplars(
    teamId: number,
    contentType: string,
    _brief: Brief
  ): Promise<string[]> {
    try {
      // ── 1. Historical exemplars from content_performance_metrics ─────────────
      const metrics = await db
        .select({
          articleId: contentPerformanceMetrics.articleId,
          socialPostId: contentPerformanceMetrics.socialPostId,
          qualityScore: contentPerformanceMetrics.qualityScore,
        })
        .from(contentPerformanceMetrics)
        .where(
          and(
            eq(contentPerformanceMetrics.teamId, teamId),
            eq(contentPerformanceMetrics.contentType, contentType),
            eq(contentPerformanceMetrics.isSuccess, 1),
            gte(contentPerformanceMetrics.qualityScore, 80)
          )
        )
        .orderBy(desc(contentPerformanceMetrics.qualityScore))
        .limit(3);

      const excerpts: string[] = [];

      for (const m of metrics) {
        try {
          if (
            (contentType === ContentType.ARTICLE || contentType === ContentType.PODCAST) &&
            m.articleId
          ) {
            const [row] = await db
              .select({ finalHtmlContent: articles.finalHtmlContent })
              .from(articles)
              .where(eq(articles.id, m.articleId))
              .limit(1);
            if (row?.finalHtmlContent) {
              const text = row.finalHtmlContent
                .replace(/<[^>]*>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
              if (text.length > 50) excerpts.push(text.slice(0, EXEMPLAR_MAX_CHARS));
            }
          } else if (contentType === ContentType.SOCIAL && m.socialPostId) {
            const [row] = await db
              .select({ caption: socialPostVariants.caption })
              .from(socialPostVariants)
              .where(eq(socialPostVariants.socialPostId, m.socialPostId))
              .orderBy(desc(socialPostVariants.id))
              .limit(1);
            if (row?.caption && row.caption.length > 20) {
              excerpts.push(row.caption.slice(0, 300));
            }
          }
        } catch {
          // Skip this metric — content may have been deleted
        }
      }

      if (excerpts.length > 0) {
        console.log(
          `[exemplars] EXEMPLAR_SOURCE: historical (${excerpts.length} for ${contentType} team=${teamId})`
        );
        return excerpts;
      }

      // ── 2. Seed exemplars from ClientBrandProfile ─────────────────────────
      // Check both profileJson.seedExemplars (primary onboarding source) and
      // manualOverridesJson.seedExemplars (manually curated override) and merge.
      const [profile] = await db
        .select({
          profileJson: clientBrandProfiles.profileJson,
          manualOverridesJson: clientBrandProfiles.manualOverridesJson,
        })
        .from(clientBrandProfiles)
        .where(eq(clientBrandProfiles.teamId, teamId))
        .limit(1);

      const profileData = profile?.profileJson as Record<string, unknown> | null;
      const overrides = profile?.manualOverridesJson as Record<string, unknown> | null;

      const fromProfile: string[] = Array.isArray(profileData?.seedExemplars)
        ? (profileData!.seedExemplars as string[]).filter((s) => typeof s === "string")
        : [];
      const fromOverrides: string[] = Array.isArray(overrides?.seedExemplars)
        ? (overrides!.seedExemplars as string[]).filter((s) => typeof s === "string")
        : [];
      // Merge, deduplicate, prefer profile-sourced exemplars first
      const seen = new Set<string>();
      const seedExemplars: string[] = [];
      for (const s of [...fromProfile, ...fromOverrides]) {
        if (!seen.has(s)) { seen.add(s); seedExemplars.push(s); }
      }

      if (seedExemplars.length > 0) {
        console.log(
          `[exemplars] EXEMPLAR_SOURCE: seed (${seedExemplars.length} for ${contentType} team=${teamId})`
        );
        return seedExemplars.slice(0, 3).map((s) => s.slice(0, EXEMPLAR_MAX_CHARS));
      }

      console.log(`[exemplars] EXEMPLAR_SOURCE: none for ${contentType} team=${teamId}`);
      return [];
    } catch (err) {
      console.warn(
        "[exemplars] retrieval failed — continuing without exemplars:",
        (err as Error).message
      );
      return [];
    }
  }

  // ==========================================================================
  // MODEL ROUTER
  // ==========================================================================
  private async callModel(
    model: string,
    prompt: string,
    temperature: number
  ): Promise<string> {
    const isGemini =
      model.toLowerCase().startsWith("gemini") ||
      model.toLowerCase().startsWith("models/");

    if (isGemini) {
      try {
        const result = await genAI.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { temperature, maxOutputTokens: 8192 },
        });
        const text = result.text ?? "";
        if (!text) throw new Error("Gemini returned empty response in repair call");
        return text;
      } catch (err) {
        console.error(`[OptimizedContentGenerator] Gemini repair call failed:`, err);
        throw err;
      }
    } else {
      return callOpenAI(
        async (client) => {
          const resp = await client.chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature,
            max_tokens: 8192,
          });
          const text = resp.choices[0]?.message?.content ?? "";
          if (!text) throw new Error("OpenAI returned empty response in repair call");
          return text;
        },
        `optimized-content-repair-${model}`
      );
    }
  }

  // ==========================================================================
  // PERSIST CONTENT
  // ==========================================================================
  private async persistContent(
    _teamId: number,
    _contentType: string,
    brief: Brief,
    _content: string
  ): Promise<number> {
    if (typeof brief.contentId !== "number" || brief.contentId <= 0) {
      throw new Error(
        "OptimizedContentGenerator.persistContent: brief.contentId must be a pre-allocated DB row ID. " +
          "For existing workers, use reviewAndRepairContent() instead of generate()."
      );
    }
    return brief.contentId;
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================
  private computeQualityScore(
    dimensionScores: Record<string, number>
  ): number {
    const values = Object.values(dimensionScores);
    if (values.length === 0) return 75;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }
}

export const optimizedContentGenerator = OptimizedContentGenerator.getInstance();

/*
────────────────────────────────────────────────────────────────────────────────
WHERE THIS SITS IN THE PIPELINE:

EXISTING WORKERS (article, social, podcast, video):
  1. Run your main generation (Gemini/GPT) — unchanged.
  2. Call reviewAndRepairContent() with the raw output.
  3. Use the repaired content going forward.
  4. Call recordContentGenerated() at completion — unchanged.
  → Adds critic loop without replacing the existing 4-stage pipeline.

THE CONTRACT THAT MAKES IT LEARN:
  injectedPatterns (assembled in step 1) MUST equal the IDs recorded in step 3.
  That identity is what lets the engagement labeler and review attribution
  credit/blame the right patterns. Break it and the loop goes open.

EXEMPLAR RETRIEVAL:
  retrieveExemplars() now queries content_performance_metrics for high-quality
  historical content (isSuccess=1, qualityScore>=80) before falling back to
  seed exemplars from ClientBrandProfile.manualOverridesJson.seedExemplars.
  Log EXEMPLAR_SOURCE: historical|seed|none for observability.

THE HONEST LIMITS:
  - Factuality: cannot reliably fix hallucinations by re-prompting.
    handleFactuality() flags them for human review instead.
  - Homogenization: always injecting top patterns makes output samey.
    Epsilon-greedy exploration in Wilson ranking is the counterweight.
  - Prompt bloat: MAX_INJECTED_PATTERNS=8 is intentional.
    Dumping 20 tactics conflicts them and the model follows none well.
────────────────────────────────────────────────────────────────────────────────
*/
