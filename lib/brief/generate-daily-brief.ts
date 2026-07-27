import { db } from "@/lib/db";
import { dailyBriefs } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_ARTICLE_MODEL } from "@/lib/ai-config";
import { assembleBriefContext, scoreActions } from "./assembler";
import { throttledGeminiRequest } from "@/lib/gemini";

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

export async function generateDailyBrief(
  userId: number,
  teamId: number,
  localDate: string,
  force: boolean = false
): Promise<GeneratedBrief | null> {
  const existingBrief = await db.query.dailyBriefs.findFirst({
    where: and(
      eq(dailyBriefs.userId, userId),
      eq(dailyBriefs.localDate, localDate)
    )
  });

  if (existingBrief?.status === 'generated' && !force) {
    return existingBrief.sectionsJson as unknown as GeneratedBrief;
  }

  // Mark as generating (upsert)
  await db.insert(dailyBriefs)
    .values({ userId, teamId, localDate, status: 'generating' })
    .onConflictDoUpdate({
      target: [dailyBriefs.userId, dailyBriefs.localDate],
      set: { status: 'generating' }
    });

  try {
    const ctx = await assembleBriefContext(userId, teamId, localDate);
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

    const result = await throttledGeminiRequest(() =>
      getGenAI().getGenerativeModel({ model: GEMINI_ARTICLE_MODEL }).generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    );

    const briefData = JSON.parse(result.response.text()) as GeneratedBrief;

    await db.update(dailyBriefs)
      .set({
        sectionsJson: briefData,
        status: 'generated',
        generatedAt: new Date(),
        todayFocusType: top.type,
        sourceMetricsJson: {
          articlesPublishedThisMonth: ctx.articlesPublishedThisMonth,
          articlesOnPage1: ctx.articlesOnPage1,
          topPerformersCount: ctx.topPerformers.length,
          learningPatternsCount: ctx.learningPatterns.length,
          daysSinceLastArticle: ctx.daysSinceLastArticle,
          hasCompetitorData: !!ctx.competitorInsights,
          candidateScores: scored.map(s => ({ type: s.type, score: s.score, action: s.action }))
        }
      })
      .where(and(
        eq(dailyBriefs.userId, userId),
        eq(dailyBriefs.localDate, localDate)
      ));

    return briefData;
  } catch (error) {
    console.error(`Failed to generate daily brief for user ${userId}:`, error);
    await db.update(dailyBriefs)
      .set({ status: 'failed' })
      .where(and(
        eq(dailyBriefs.userId, userId),
        eq(dailyBriefs.localDate, localDate)
      ));
    throw error;
  }
}
