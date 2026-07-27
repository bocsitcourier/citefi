import { db } from "@/lib/db";
import { dailyBriefs } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_ARTICLE_MODEL } from "@/lib/ai-config";
import { assembleBriefContext, scoreActions } from "./assembler";
import { throttledGeminiRequest } from "@/lib/gemini";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface GeneratedBrief {
  todayFocus: {
    type: string;
    action: string;
    why: string;
    ctaPath: string;
  };
  overnightMovement: {
    headline: string;
    items: string[];
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

/**
 * Generates a daily marketing brief for a user/team using Gemini AI.
 * Follows the 6-section structure defined in the GeneratedBrief interface.
 */
export async function generateDailyBrief(
  userId: number,
  teamId: number,
  localDate: string,
  force: boolean = false
): Promise<GeneratedBrief | null> {
  // 1. Check for existing brief (status='generated') for (userId, localDate)
  const existingBrief = await db.query.dailyBriefs.findFirst({
    where: and(
      eq(dailyBriefs.userId, userId),
      eq(dailyBriefs.localDate, localDate)
    )
  });

  if (existingBrief?.status === 'generated' && !force) {
    return existingBrief.sectionsJson as unknown as GeneratedBrief;
  }

  // 2. Upsert brief row with status='generating'
  await db.insert(dailyBriefs)
    .values({
      userId,
      teamId,
      localDate,
      status: 'generating',
    })
    .onConflictDoUpdate({
      target: [dailyBriefs.userId, dailyBriefs.localDate],
      set: { status: 'generating' }
    });

  try {
    // 3. Assemble context and score actions
    const ctx = await assembleBriefContext(userId, teamId, localDate);
    const actions = scoreActions(ctx, existingBrief?.todayFocusType || undefined);
    const topAction = actions[0];

    if (!topAction) {
      throw new Error("No marketing actions could be determined for this brief.");
    }

    // 4. Build focused Gemini prompt
    const prompt = `You are "Citefi Coach", a world-class AI marketing strategist. 
Your goal is to provide a concise, highly actionable daily brief to a marketing team.

**BRAND CONTEXT:**
- Company: ${ctx.brandProfile?.companyName || 'Citefi Client'}
- Focus: ${ctx.brandProfile?.brandVoice || 'Professional & Data-Driven'}
- Persona: ${ctx.persona?.name || 'Target Audience'} (${ctx.persona?.description || ''})

**PERFORMANCE DATA:**
- Articles Published This Month: ${ctx.articlesPublishedThisMonth}
- Articles on Page 1 (Estimated): ${ctx.articlesOnPage1}
- Top Performing Content: ${ctx.topPerformers.map(p => p.chosenTitle).join(', ') || 'None yet'}
- Recent Content: ${ctx.recentArticles.map(a => a.chosenTitle).join(', ') || 'None yet'}

**INTELLIGENCE:**
- Learning Patterns: ${ctx.learningPatterns.map(p => p.patternName).join(', ') || 'Analyzing trends...'}
- Competitor Insights: ${JSON.stringify(ctx.competitorInsights) || 'Monitoring competitors...'}

**TODAY'S TOP ACTION:**
- Action: ${topAction.action}
- Why: ${topAction.why}
- Type: ${topAction.type}

**INSTRUCTIONS:**
Generate a daily brief in strict JSON format matching this schema:
{
  "todayFocus": { "type": "${topAction.type}", "action": "${topAction.action}", "why": "${topAction.why}", "ctaPath": "${topAction.ctaPath}" },
  "overnightMovement": { "headline": "string", "items": ["string (max 3 items)"] },
  "competitorWatch": { "headline": "string", "insights": ["string (max 2 items)"] },
  "teachingMoment": { "lesson": "string", "groundedIn": "string (one of the performance metrics or patterns above)" },
  "voicePrompt": { "nudge": "string (a short, catchy prompt for the user to record a voice update)" },
  "motivation": { "headline": "string", "evidence": ["string (specific data-backed win)"] }
}

Guidelines:
- Keep it punchy, professional, and encouraging.
- Focus on information gain and unique local insights.
- Ensure all items are specific to the brand context provided.
- DO NOT use emojis.
- Response must be ONLY the JSON object.`;

    // 5. Call Gemini
    const result = await throttledGeminiRequest(() => genAI.getGenerativeModel({ model: GEMINI_ARTICLE_MODEL }).generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      }
    }));

    const responseText = result.response.text();
    const briefData = JSON.parse(responseText) as GeneratedBrief;

    // 6. Update brief row
    await db.update(dailyBriefs)
      .set({
        sectionsJson: briefData,
        status: 'generated',
        generatedAt: new Date(),
        todayFocusType: topAction.type,
        sourceMetricsJson: {
          articlesPublishedThisMonth: ctx.articlesPublishedThisMonth,
          articlesOnPage1: ctx.articlesOnPage1,
          topPerformersCount: ctx.topPerformers.length,
          learningPatternsCount: ctx.learningPatterns.length
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
