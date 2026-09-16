import { db } from "@/lib/db";
import { dailyBriefs } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { GEMINI_ARTICLE_MODEL } from "@/lib/ai-config";
import { assembleBriefContext, scoreActions, type BriefContext } from "./assembler";
import { throttledGeminiRequest, submitGeminiRequest } from "@/lib/gemini";
import type {
  GeminiAttemptReceiptContext,
  GeminiGenerateRequest,
} from "@/lib/gemini-attempt-receipt";
import { z } from "zod";
import { createHash } from "node:crypto";
import { extractGeminiUsage, isProviderAccountingError, logCostTelemetry, logFailedProviderAttempt } from "@/lib/cost-telemetry";

// Strict runtime validation — catches hallucinated or truncated Gemini output before we persist it
const GeneratedBriefSchema = z.object({
  todayFocus: z.object({
    type: z.string().min(1),
    action: z.string().min(1),
    why: z.string().min(1),
    ctaPath: z.string().min(1),
    urgencySignal: z.string().optional(),
  }),
  overnightMovement: z.object({
    headline: z.string().min(1),
    items: z.array(z.string()).default([]),
    quietDay: z.boolean().optional(),
  }),
  competitorWatch: z.object({
    headline: z.string().min(1),
    insights: z.array(z.string()).default([]),
  }),
  teachingMoment: z.object({
    lesson: z.string().min(1),
    groundedIn: z.string().min(1),
  }),
  voicePrompt: z.object({
    nudge: z.string().min(1),
  }),
  motivation: z.object({
    headline: z.string().min(1),
    evidence: z.array(z.string()).default([]),
  }),
});

// Lazy getter — never throw at module scope (Turbopack silent-404 issue)
let _genAI: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!_genAI) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
    _genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _genAI;
}

export interface GeneratedBrief {
  todayFocus: {
    type: string;
    action: string;
    why: string;
    ctaPath: string;
    urgencySignal?: string;
  };
  overnightMovement: {
    headline: string;
    items: string[];
    quietDay?: boolean;
  };
  competitorWatch: {
    headline: string;
    insights: string[];
  };
  teachingMoment: {
    lesson: string;
    groundedIn: string;
  };
  voicePrompt: {
    nudge: string;
  };
  motivation: {
    headline: string;
    evidence: string[];
  };
}

interface ExistingDailyBrief {
  status: string | null;
  sectionsJson: unknown;
  todayFocusType: string | null;
}

interface PersistedDailyBriefInput {
  briefData: GeneratedBrief;
  todayFocusType: string;
  sourceMetricsJson: Record<string, unknown>;
}

interface DailyBriefTelemetryInput {
  result: GenerateContentResponse;
  teamId: number;
  userId: number;
  providerMetadata: { queryHash: string };
  latencyMs: number;
}

interface DailyBriefFailedTelemetryInput extends DailyBriefTelemetryInput {
  error: unknown;
}

/**
 * Test and adapter seam for the production daily-brief flow.
 *
 * The default implementations below remain the worker/database/Gemini path.
 * A caller may replace the persistence and provider boundary together so a
 * deterministic fixture can exercise output validation and receipt accounting
 * without contacting Gemini or using the application database.
 */
export interface DailyBriefGenerationDependencies {
  findExistingBrief?: (
    userId: number,
    localDate: string,
  ) => Promise<ExistingDailyBrief | null>;
  markGenerating?: (
    userId: number,
    teamId: number,
    localDate: string,
  ) => Promise<void>;
  persistGenerated?: (
    userId: number,
    localDate: string,
    input: PersistedDailyBriefInput,
  ) => Promise<void>;
  markFailed?: (userId: number, localDate: string) => Promise<void>;
  assembleContext?: (
    userId: number,
    teamId: number,
    localDate: string,
  ) => Promise<BriefContext>;
  provider?: (
    request: GeminiGenerateRequest,
    context: GeminiAttemptReceiptContext,
    call: () => Promise<GenerateContentResponse>,
  ) => Promise<GenerateContentResponse>;
  logCostTelemetry?: (input: DailyBriefTelemetryInput) => Promise<void>;
  logFailedProviderAttempt?: (input: DailyBriefFailedTelemetryInput) => Promise<void>;
}

export async function generateDailyBrief(
  userId: number,
  teamId: number,
  localDate: string,
  force: boolean = false,
  dependencies: DailyBriefGenerationDependencies = {},
): Promise<GeneratedBrief | null> {
  const findExistingBrief = dependencies.findExistingBrief ?? (async () => {
    return await db.query.dailyBriefs.findFirst({
      where: and(
        eq(dailyBriefs.userId, userId),
        eq(dailyBriefs.localDate, localDate)
      )
    }) as ExistingDailyBrief | null;
  });
  const markGenerating = dependencies.markGenerating ?? (async () => {
    await db.insert(dailyBriefs)
      .values({ userId, teamId, localDate, status: 'generating' })
      .onConflictDoUpdate({
        target: [dailyBriefs.userId, dailyBriefs.localDate],
        set: { status: 'generating' }
      });
  });
  const persistGenerated = dependencies.persistGenerated ?? (async (
    _userId,
    _localDate,
    input,
  ) => {
    await db.update(dailyBriefs)
      .set({
        sectionsJson: input.briefData,
        status: 'generated',
        generatedAt: new Date(),
        todayFocusType: input.todayFocusType,
        sourceMetricsJson: input.sourceMetricsJson,
      })
      .where(and(
        eq(dailyBriefs.userId, userId),
        eq(dailyBriefs.localDate, localDate)
      ));
  });
  const markFailed = dependencies.markFailed ?? (async () => {
    await db.update(dailyBriefs)
      .set({ status: 'failed' })
      .where(and(
        eq(dailyBriefs.userId, userId),
        eq(dailyBriefs.localDate, localDate)
      ));
  });
  const assembleContext = dependencies.assembleContext ?? assembleBriefContext;
  const runProvider = dependencies.provider ?? ((
    request,
    context,
    call,
  ) => throttledGeminiRequest(
    () => submitGeminiRequest(request, context, call),
  ));

  const existingBrief = await findExistingBrief(userId, localDate);

  if (existingBrief?.status === 'generated' && !force) {
    return existingBrief.sectionsJson as unknown as GeneratedBrief;
  }

  // Mark as generating (upsert)
  await markGenerating(userId, teamId, localDate);

  try {
    const ctx = await assembleContext(userId, teamId, localDate);
    const { scored, top } = scoreActions(ctx, existingBrief?.todayFocusType || undefined);

    if (!top) throw new Error("No marketing actions could be scored for this brief.");

    const companyName = ctx.brandProfile?.companyName || 'your business';
    const brandVoice = ctx.brandProfile?.brandVoice || 'professional and trustworthy';
    const location = ctx.brandProfile?.targetLocation || ctx.brandProfile?.primaryLocation || 'your service area';
    const personaName = ctx.persona?.name || 'local business owner';
    const personaDesc = ctx.persona?.description || '';

    const prompt = `You are "Citefi Coach" — a concise, honest daily marketing advisor for ${companyName}.
Write in a direct, specific tone. Never use filler phrases or generic marketing speak.
Brand voice: ${brandVoice}. Audience: ${personaName}${personaDesc ? ` (${personaDesc})` : ''}.
Location/market: ${location}.

PERFORMANCE DATA:
- Articles published this month: ${ctx.articlesPublishedThisMonth}
- Articles estimated on Page 1: ${ctx.articlesOnPage1}
- Top performing content: ${ctx.topPerformers.map(p => p?.chosenTitle || p?.title).filter(Boolean).join(', ') || 'none yet'}
- Recent content: ${ctx.recentArticles.slice(0, 3).map(a => a?.chosenTitle || a?.title).filter(Boolean).join(', ') || 'none yet'}
- Days since last article: ${ctx.daysSinceLastArticle ?? 'unknown'}

INTELLIGENCE:
- Learning patterns: ${ctx.learningPatterns.map(p => p.patternName).join(', ') || 'still analyzing'}
- Competitor data: ${ctx.competitorInsights ? JSON.stringify(ctx.competitorInsights).slice(0, 400) : 'monitoring...'}

TODAY'S PRIORITIZED ACTION (highest-scored from engine):
- Type: ${top.type}
- Action: ${top.action}
- Why now: ${top.why}
- Signal strength: ${top.score}/100

SCORING BREAKDOWN (for context):
${scored.slice(0, 4).map(s => `- ${s.type} (${s.score}/100): ${s.action}`).join('\n')}

Generate a daily brief as strict JSON. Rules:
1. todayFocus must be SPECIFIC to their actual data — use real numbers, real content titles where available.
2. overnightMovement — only include things that genuinely moved. Set quietDay:true if nothing significant happened.
3. competitorWatch — frame as opportunity, never as threat. 2 insights max.
4. teachingMoment — ground the lesson in their specific data point. Never abstract.
5. voicePrompt — a 1-sentence creative nudge for their brand voice.
6. motivation — must cite a real metric. Never hollow ("you've got this").
7. Never use emojis. Never start a sentence with "I". Keep each item under 40 words.

JSON schema:
{
  "todayFocus": { "type": "${top.type}", "action": string, "why": string, "ctaPath": "${top.ctaPath}", "urgencySignal": string },
  "overnightMovement": { "headline": string, "items": [string], "quietDay": boolean },
  "competitorWatch": { "headline": string, "insights": [string] },
  "teachingMoment": { "lesson": string, "groundedIn": string },
  "voicePrompt": { "nudge": string },
  "motivation": { "headline": string, "evidence": [string] }
}

Respond with ONLY the JSON object.`;

    const startedAt = Date.now(), providerMetadata = { queryHash: createHash("sha256").update(prompt).digest("hex") };
      const attemptKey = `daily-brief:${teamId}:${userId}:${localDate}`;
    let result: any;
    try {
      const generationRequest = {
        model: GEMINI_ARTICLE_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" },
      };
      const providerContext: GeminiAttemptReceiptContext = {
        teamId,
        userId,
        operationType: "other",
        resourceType: "daily_brief",
        // The brief row does not exist yet. Team/user ownership is checked
        // before generation; the date identity belongs in attemptKey.
        attemptKey,
        attempt: 1,
      };
      result = await runProvider(
        generationRequest,
        providerContext,
        () => getGenAI().models.generateContent(generationRequest),
      );
      const telemetryInput: DailyBriefTelemetryInput = {
        result,
        teamId,
        userId,
        providerMetadata,
        latencyMs: Date.now() - startedAt,
      };
      if (dependencies.logCostTelemetry) {
        await dependencies.logCostTelemetry(telemetryInput);
      } else {
        await logCostTelemetry({ operationType: "other", provider: "gemini", model: GEMINI_ARTICLE_MODEL, teamId, userId,
          providerRequestId: result.responseId ?? null, providerMetadata },
        extractGeminiUsage(result), telemetryInput.latencyMs);
      }
    } catch (error) {
      if (isProviderAccountingError(error)) throw error;
      const telemetryInput: DailyBriefFailedTelemetryInput = {
        result: result as GenerateContentResponse,
        teamId,
        userId,
        providerMetadata,
        latencyMs: Date.now() - startedAt,
        error,
      };
      if (dependencies.logFailedProviderAttempt) {
        await dependencies.logFailedProviderAttempt(telemetryInput);
      } else {
        await logFailedProviderAttempt({ operationType: "other", provider: "gemini", model: GEMINI_ARTICLE_MODEL, teamId, userId, providerMetadata },
          { totalTokens: 0 }, telemetryInput.latencyMs, error);
      }
      throw error;
    }

    const rawJson = JSON.parse(result.text ?? "");
    const parsed = GeneratedBriefSchema.safeParse(rawJson);
    if (!parsed.success) {
      throw new Error(`Gemini returned invalid brief shape: ${parsed.error.message}`);
    }
    const briefData = parsed.data as GeneratedBrief;

    await persistGenerated(userId, localDate, {
      briefData,
      todayFocusType: top.type,
      sourceMetricsJson: {
        articlesPublishedThisMonth: ctx.articlesPublishedThisMonth,
        articlesOnPage1: ctx.articlesOnPage1,
        topPerformersCount: ctx.topPerformers.length,
        learningPatternsCount: ctx.learningPatterns.length,
        daysSinceLastArticle: ctx.daysSinceLastArticle,
        hasCompetitorData: !!ctx.competitorInsights,
        candidateScores: scored.map(s => ({ type: s.type, score: s.score, action: s.action }))
      },
    });

    return briefData;
  } catch (error) {
    if (isProviderAccountingError(error)) throw error;
    console.error(`Failed to generate daily brief for user ${userId}:`, error);
    await markFailed(userId, localDate);
    throw error;
  }
}
