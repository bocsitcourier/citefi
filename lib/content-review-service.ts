import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import {
  contentReviews,
  patternDimensionStats,
  contentPerformanceMetrics,
  aiLearningLedger,
  articles,
  ContentType,
} from "../shared/schema";
import { analyzeContentQuality } from "./deterministic-humanizer";
import { factStore } from "./fact-store";
import { callOpenAI } from "./openai-client";

export type Dimension = "completeness" | "factuality" | "structure" | "humanness" | "engagement";
const ALL_DIMS: Dimension[] = ["completeness", "factuality", "structure", "humanness", "engagement"];
const PASS_THRESHOLD = 70;

export function wilsonLowerBound(successes: number, trials: number, z = 1.96): number {
  if (trials === 0) return 0;
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = p + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials);
  return Math.max(0, Math.round(((center - margin) / denom) * 100));
}

export const DEFECT = {
  TRUNCATED:         { code: "completeness:truncated",        dim: "completeness" as Dimension, severity: "high" },
  MISSING_SECTION:   { code: "completeness:missing_section",  dim: "completeness" as Dimension, severity: "high" },
  THIN_SECTION:      { code: "completeness:thin_section",     dim: "completeness" as Dimension, severity: "medium" },
  UNANSWERED_BRIEF:  { code: "completeness:unanswered_brief", dim: "completeness" as Dimension, severity: "high" },
  UNSUPPORTED_CLAIM: { code: "factuality:unsupported_claim",  dim: "factuality"   as Dimension, severity: "high" },
  FAKE_CITATION:     { code: "factuality:fake_citation",      dim: "factuality"   as Dimension, severity: "high" },
  NO_ANSWER_FIRST:   { code: "structure:no_answer_first",     dim: "structure"    as Dimension, severity: "medium" },
  BAD_HEADINGS:      { code: "structure:bad_headings",        dim: "structure"    as Dimension, severity: "low" },
  MISSING_FAQ:       { code: "structure:missing_faq",         dim: "structure"    as Dimension, severity: "medium" },
  MISSING_SCHEMA:    { code: "structure:missing_schema",      dim: "structure"    as Dimension, severity: "low" },
  AI_ISMS:           { code: "humanness:ai_isms",             dim: "humanness"    as Dimension, severity: "medium" },
  LOW_BURSTINESS:    { code: "humanness:low_burstiness",      dim: "humanness"    as Dimension, severity: "medium" },
  REPETITIVE_OPEN:   { code: "humanness:repetitive_openings", dim: "humanness"    as Dimension, severity: "low" },
  WEAK_HOOK:         { code: "channel:weak_hook",             dim: "engagement"   as Dimension, severity: "high" },
  NO_CTA:            { code: "channel:no_cta",                dim: "engagement"   as Dimension, severity: "medium" },
  NO_PACING:         { code: "channel:no_pacing_markers",     dim: "engagement"   as Dimension, severity: "low" },
} as const;

interface Defect { code: string; dim: Dimension; severity: string; evidence: string }
interface ReviewResult {
  contentId: number;
  contentType: string;
  dimensionScores: Record<Dimension, number>;
  defects: Defect[];
  passed: boolean;
}
interface Brief {
  targetWords?: number;
  keyword?: string;
  questions?: string[];
}

const NEGATIVE_CONSTRAINT_MAP: Record<string, string> = {
  "COMPLETENESS:TRUNCATED": "Finish every section. Never end mid-thought or cut the article short.",
  "COMPLETENESS:UNANSWERED_BRIEF": "Explicitly answer every question in the brief.",
  "COMPLETENESS:THIN_SECTION": "Each H2 section must have at least 120 words of substance.",
  "FACTUALITY:UNSUPPORTED_CLAIM": "Only state statistics/claims you can ground in provided facts. Otherwise speak qualitatively.",
  "FACTUALITY:FAKE_CITATION": "Do not invent citations, URLs, or named sources.",
  "STRUCTURE:MISSING_FAQ": "Always include an FAQ section.",
  "STRUCTURE:NO_ANSWER_FIRST": "Open with a direct answer containing the target keyword in the first 80 words.",
  "HUMANNESS:AI_ISMS": "Avoid AI-isms (leverage, dive into, in today's world, it's worth noting).",
  "HUMANNESS:LOW_BURSTINESS": "Vary sentence length sharply — mix short punchy lines with longer ones.",
  "CHANNEL:WEAK_HOOK": "Lead with a hook that lands in the first 3 seconds.",
  "CHANNEL:NO_CTA": "End with a clear, natural call to action.",
};

export class ContentReviewService {
  private static instance: ContentReviewService;
  static getInstance() {
    if (!this.instance) this.instance = new ContentReviewService();
    return this.instance;
  }

  async reviewContent(
    teamId: number,
    contentId: number,
    contentType: string,
    content: string,
    brief: Brief = {},
    opts: { useJudge?: boolean } = {}
  ): Promise<ReviewResult> {
    const defects: Defect[] = [];

    defects.push(...this.deterministicChecks(content, contentType, brief));
    defects.push(...(await this.factualityChecks(teamId, content)));

    let judgeScores: Partial<Record<Dimension, number>> = {};
    if (opts.useJudge) {
      try {
        const j = await this.judge(content, contentType);
        judgeScores = j.scores;
        defects.push(...j.defects);
      } catch (e) {
        console.warn("⚠️ Judge failed, using deterministic only:", e);
      }
    }

    const dimensionScores = this.scoreDimensions(defects, judgeScores);
    const hasHighDefect = (d: Dimension) => defects.some(x => x.dim === d && x.severity === "high");
    const passed = ALL_DIMS.every(d => dimensionScores[d] >= PASS_THRESHOLD && !hasHighDefect(d));

    const result: ReviewResult = { contentId, contentType, dimensionScores, defects, passed };

    await db.insert(contentReviews).values({
      teamId,
      contentType,
      articleId: contentType === ContentType.ARTICLE ? contentId : null,
      socialPostId: contentType === ContentType.SOCIAL ? contentId : null,
      videoIdeaId: contentType === ContentType.VIDEO ? contentId : null,
      dimensionScoresJson: dimensionScores,
      defectsJson: defects,
      passed: passed ? 1 : 0,
      usedJudge: opts.useJudge ? 1 : 0,
    });

    return result;
  }

  private deterministicChecks(content: string, contentType: string, brief: Brief): Defect[] {
    const defects: Defect[] = [];
    const text = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const words = text ? text.split(/\s+/).length : 0;

    if (!/[.!?]["')\]]?\s*$/.test(text)) {
      defects.push({ ...DEFECT.TRUNCATED, evidence: "no terminal punctuation — likely cut off" });
    }
    if (brief.targetWords && words < brief.targetWords * 0.6) {
      defects.push({ ...DEFECT.TRUNCATED, evidence: `${words}/${brief.targetWords} words` });
    }
    for (const q of brief.questions || []) {
      const keyTerms = q.toLowerCase().match(/\b\w{4,}\b/g) || [];
      const hit = keyTerms.filter(t => text.toLowerCase().includes(t)).length;
      if (keyTerms.length && hit / keyTerms.length < 0.4) {
        defects.push({ ...DEFECT.UNANSWERED_BRIEF, evidence: `unanswered: "${q.slice(0, 80)}"` });
      }
    }

    if (contentType === ContentType.ARTICLE) {
      const h2s = (content.match(/<h2[\s>]/gi) || []).length;
      if (h2s === 0) defects.push({ ...DEFECT.BAD_HEADINGS, evidence: "no H2 headings" });
      if (h2s > 0 && words / h2s < 80) {
        defects.push({ ...DEFECT.THIN_SECTION, evidence: `~${Math.round(words / h2s)} words/section` });
      }
      if (!/frequently asked|<h[23][^>]*>\s*faq/i.test(content) && !/\bFAQ\b/.test(content)) {
        defects.push({ ...DEFECT.MISSING_FAQ, evidence: "no FAQ section" });
      }
      if (!/application\/ld\+json|"@type"/i.test(content)) {
        defects.push({ ...DEFECT.MISSING_SCHEMA, evidence: "no JSON-LD schema" });
      }
      if (brief.keyword) {
        const intro = text.slice(0, 500).toLowerCase();
        if (!intro.includes(brief.keyword.toLowerCase())) {
          defects.push({ ...DEFECT.NO_ANSWER_FIRST, evidence: "keyword absent from opening" });
        }
      }
    }

    if (contentType === ContentType.VIDEO || contentType === ContentType.PODCAST) {
      if (!/\[?hook\]?|0:0\d|first \d+ seconds/i.test(content)) {
        defects.push({ ...DEFECT.WEAK_HOOK, evidence: "no identifiable hook/open" });
      }
      if (!/subscribe|follow|link in|call to action|cta/i.test(content)) {
        defects.push({ ...DEFECT.NO_CTA, evidence: "no CTA found" });
      }
      if (contentType === ContentType.VIDEO && !/visual:|b-?roll|on-?screen|\[\d+:\d+\]/i.test(content)) {
        defects.push({ ...DEFECT.NO_PACING, evidence: "no visual/timecode direction" });
      }
    }

    const q = analyzeContentQuality(text);
    if (q.aiIsmCount > 3) defects.push({ ...DEFECT.AI_ISMS, evidence: `${q.aiIsmCount} AI-isms` });
    if (q.burstiness < 0.3) defects.push({ ...DEFECT.LOW_BURSTINESS, evidence: `burstiness ${q.burstiness}` });
    const openers = (text.match(/(^|[.!?]\s+)(\w+\s+\w+)/g) || []).map(s => s.trim().toLowerCase());
    const dupes = openers.length - new Set(openers).size;
    if (openers.length > 10 && dupes / openers.length > 0.3) {
      defects.push({ ...DEFECT.REPETITIVE_OPEN, evidence: `${dupes} repeated sentence openers` });
    }

    return defects;
  }

  private async factualityChecks(teamId: number, content: string): Promise<Defect[]> {
    const defects: Defect[] = [];
    const text = content.replace(/<[^>]*>/g, " ");
    const claimRegex =
      /[^.!?]*?(\d+(\.\d+)?\s?%|\d+\s?percent|according to|studies show|research (shows|indicates|finds)|data (shows|suggests)|survey|in (19|20)\d{2})[^.!?]*[.!?]/gi;
    const claims = [...new Set(text.match(claimRegex) || [])].slice(0, 25);

    for (const claim of claims) {
      const facts = await factStore.searchFacts({ teamId, query: claim.slice(0, 120), limit: 3 });
      if (facts.length === 0) {
        defects.push({ ...DEFECT.UNSUPPORTED_CLAIM, evidence: claim.trim().slice(0, 140) });
      }
    }

    const citations = text.match(/\(([^)]*(?:\.com|\.org|\.gov|et al\.|\d{4})[^)]*)\)/gi) || [];
    for (const cite of citations.slice(0, 15)) {
      const facts = await factStore.searchFacts({ teamId, query: cite.slice(0, 100), limit: 2 });
      if (facts.length === 0) {
        defects.push({ ...DEFECT.FAKE_CITATION, evidence: cite.slice(0, 120) });
      }
    }

    return defects;
  }

  private async judge(
    content: string,
    contentType: string
  ): Promise<{ scores: Partial<Record<Dimension, number>>; defects: Defect[] }> {
    const rubric = this.rubricFor(contentType);
    const prompt = `You are a strict editorial reviewer. Score the content 0-100 on each dimension and list concrete, evidence-backed defects. A 70 is "publishable", 90+ is "excellent".

DIMENSIONS: completeness, factuality, structure, humanness, engagement
RUBRIC: ${rubric}

Return ONLY valid JSON:
{"completeness":n,"factuality":n,"structure":n,"humanness":n,"engagement":n,"defects":[{"code":"<dimension>:<slug>","evidence":"<quote or specifics>"}]}

CONTENT:
${content.slice(0, 8000)}`;

    const raw = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-5.4-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
      "ContentReview judge"
    );

    const text = raw.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    const scores: Partial<Record<Dimension, number>> = {};
    for (const d of ALL_DIMS) if (typeof parsed[d] === "number") scores[d] = parsed[d];
    const defects: Defect[] = (parsed.defects || []).map((x: any) => ({
      code: x.code,
      dim: (x.code?.split(":")[0] || "structure") as Dimension,
      severity: "medium",
      evidence: x.evidence || "",
    }));
    return { scores, defects };
  }

  private rubricFor(contentType: string): string {
    const common = "completeness: every promised section present and substantive. structure: logical flow, scannable. humanness: varied sentences, no AI-isms.";
    const byType: Record<string, string> = {
      [ContentType.ARTICLE]: `${common} factuality: claims specific and sourceable. engagement: strong answer-first opening.`,
      [ContentType.VIDEO]: `${common} engagement: hook lands in first 3s, clear pacing, CTA natural.`,
      [ContentType.PODCAST]: `${common} engagement: cold-open hook, energy variation, conversational.`,
      [ContentType.SOCIAL]: `${common} engagement: scroll-stopping hook, drives reply/share.`,
    };
    return byType[contentType] || byType[ContentType.ARTICLE]!;
  }

  private scoreDimensions(
    defects: Defect[],
    judge: Partial<Record<Dimension, number>>
  ): Record<Dimension, number> {
    const out = {} as Record<Dimension, number>;
    const penalty = { high: 35, medium: 15, low: 5 } as Record<string, number>;
    for (const d of ALL_DIMS) {
      let score = judge[d] ?? 100;
      for (const def of defects.filter(x => x.dim === d)) {
        score -= penalty[def.severity] ?? 10;
      }
      out[d] = Math.max(0, Math.min(100, Math.round(score)));
    }
    return out;
  }

  async mineCorpus(
    teamId: number,
    contentType: string,
    opts: { limit?: number; judgeSampleRate?: number } = {}
  ): Promise<{ reviewed: number; topDefects: Array<{ code: string; count: number }> }> {
    const judgeRate = opts.judgeSampleRate ?? 0.2;
    const rows = await db
      .select()
      .from(articles)
      .where(eq(articles.teamId, teamId))
      .orderBy(desc(articles.createdAt))
      .limit(opts.limit ?? 500);

    const defectCounts = new Map<string, number>();
    let reviewed = 0;

    for (const row of rows) {
      const [perf] = await db
        .select()
        .from(contentPerformanceMetrics)
        .where(
          and(
            eq(contentPerformanceMetrics.teamId, teamId),
            eq(contentPerformanceMetrics.articleId, row.id)
          )
        )
        .limit(1);

      const brief: Brief = {
        targetWords: 2000,
        keyword: (row as any).keyword ?? undefined,
        questions: ((row.metadata as any)?.research?.redditQuestions || [])
          .slice(0, 10)
          .map((q: any) => q.title),
      };

      const review = await this.reviewContent(
        teamId, row.id, contentType, row.content, brief,
        { useJudge: Math.random() < judgeRate }
      );
      reviewed++;
      for (const d of review.defects) defectCounts.set(d.code, (defectCounts.get(d.code) || 0) + 1);

      const patternsUsed = (perf?.patternsUsedJson as number[]) || [];
      await this.attributeReview(patternsUsed, review);
    }

    const topDefects = [...defectCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([code, count]) => ({ code, count }));

    await this.recordCorpusDefects(teamId, contentType, topDefects);
    console.log(`🔬 Mined ${reviewed} ${contentType} pieces. Top defect: ${topDefects[0]?.code} (${topDefects[0]?.count}x)`);
    return { reviewed, topDefects };
  }

  async attributeReview(patternIds: number[], review: ReviewResult): Promise<void> {
    for (const dim of ALL_DIMS) {
      const hasHigh = review.defects.some(d => d.dim === dim && d.severity === "high");
      const success = review.dimensionScores[dim] >= PASS_THRESHOLD && !hasHigh;
      for (const pid of patternIds) {
        await this.updatePatternDimension(pid, dim, success);
      }
    }
  }

  async updatePatternDimension(patternId: number, dimension: Dimension, success: boolean): Promise<void> {
    const [stat] = await db
      .select()
      .from(patternDimensionStats)
      .where(and(
        eq(patternDimensionStats.patternId, patternId),
        eq(patternDimensionStats.dimension, dimension)
      ))
      .limit(1);

    const successes = (stat?.successes || 0) + (success ? 1 : 0);
    const trials = (stat?.trials || 0) + 1;
    const wilson = wilsonLowerBound(successes, trials);

    if (stat) {
      await db.update(patternDimensionStats)
        .set({ successes, trials, wilsonScore: wilson, updatedAt: new Date() })
        .where(eq(patternDimensionStats.id, stat.id));
    } else {
      await db.insert(patternDimensionStats).values({
        patternId, dimension, successes, trials, wilsonScore: wilson,
      });
    }
  }

  private async recordCorpusDefects(
    teamId: number,
    contentType: string,
    defects: Array<{ code: string; count: number }>
  ): Promise<void> {
    const now = new Date();
    for (const { code, count } of defects) {
      const errorType = code.toUpperCase();
      const [existing] = await db
        .select()
        .from(aiLearningLedger)
        .where(and(
          eq(aiLearningLedger.teamId, teamId),
          eq(aiLearningLedger.contentType, contentType),
          eq(aiLearningLedger.errorType, errorType)
        ))
        .limit(1);
      if (existing) {
        await db.update(aiLearningLedger)
          .set({ count: existing.count + count, lastOccurrence: now })
          .where(eq(aiLearningLedger.id, existing.id));
      } else {
        await db.insert(aiLearningLedger).values({ teamId, contentType, errorType, count, lastOccurrence: now });
      }
    }
  }

  async getNegativeConstraints(teamId: number, contentType: string, limit = 5): Promise<string[]> {
    const rows = await db
      .select()
      .from(aiLearningLedger)
      .where(and(eq(aiLearningLedger.teamId, teamId), eq(aiLearningLedger.contentType, contentType)))
      .orderBy(desc(aiLearningLedger.count))
      .limit(limit);
    return rows.map(r => NEGATIVE_CONSTRAINT_MAP[r.errorType]).filter(Boolean) as string[];
  }
}

export const contentReviewService = ContentReviewService.getInstance();
