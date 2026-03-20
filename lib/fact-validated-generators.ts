import { factStore, FactPack } from "./fact-store";
import { GoogleGenAI } from "@google/genai";
import { antiHallucination, ValidationResult } from "./anti-hallucination";
import { generateVerifiedContent, VerifiedGenerationResult } from "./verified-content-generator";
import { GEMINI_FLASH_MODEL } from "./ai-config";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function callGeminiWithRetry(prompt: string, options?: { model?: string; responseFormat?: string }): Promise<string> {
  const result = await genAI.models.generateContent({
    model: options?.model || GEMINI_FLASH_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  return result.text || "";
}

export interface FactValidationOptions {
  teamId: number;
  enableFactValidation?: boolean;
  minConfidence?: number;
  entityTypes?: string[];
  categories?: string[];
  topic?: string;
  contentId?: number;
}

export interface FactValidatedResult<T> {
  result: T;
  factValidation?: {
    enabled: boolean;
    factCount: number;
    confidenceRange: { min: number; max: number };
    validationResult?: ValidationResult;
    gapReport?: {
      status: "INSUFFICIENT_DATA";
      missing: string[];
      suggestedActions: string[];
    };
  };
}

const DEFAULT_CONFIDENCE_THRESHOLDS = {
  article: 80,
  social: 70,
  video: 75,
  podcast: 70,
};

export async function validateContentWithFacts(
  rawContent: string,
  contentType: "article" | "social" | "video" | "podcast",
  options: FactValidationOptions
): Promise<{
  isValid: boolean;
  validatedContent: string;
  validationResult: ValidationResult | null;
  factPack: FactPack;
  gapReport?: {
    status: "INSUFFICIENT_DATA";
    missing: string[];
    suggestedActions: string[];
  };
}> {
  const {
    teamId,
    enableFactValidation = true,
    minConfidence = DEFAULT_CONFIDENCE_THRESHOLDS[contentType],
    entityTypes,
    categories,
    topic,
    contentId,
  } = options;

  if (!enableFactValidation) {
    console.log(`[FactValidation] Validation disabled for ${contentType}`);
    return {
      isValid: true,
      validatedContent: rawContent,
      validationResult: null,
      factPack: { facts: [], totalCount: 0, confidenceRange: { min: 0, max: 0 }, categories: [], entityTypes: [] },
    };
  }

  console.log(`[FactValidation] Starting validation for ${contentType} (team ${teamId})`);

  const factPack = await antiHallucination.getFactPackForGeneration({
    teamId,
    contentType,
    contentId,
    topic,
    entityTypes,
    categories,
    minConfidence,
  });

  console.log(`[FactValidation] Loaded ${factPack.totalCount} facts`);

  if (factPack.facts.length === 0) {
    console.warn(`[FactValidation] No facts available - returning content unvalidated`);
    return {
      isValid: true,
      validatedContent: rawContent,
      validationResult: null,
      factPack,
      gapReport: {
        status: "INSUFFICIENT_DATA",
        missing: ["No verified facts found for this topic/entity"],
        suggestedActions: [
          "Add verified facts to the fact store before generating content",
          "Use /api/facts to create facts with sources and confidence scores",
        ],
      },
    };
  }

  const contract = {
    teamId,
    agentName: `${contentType}-validator`,
    contentType,
    allowedOperations: ["transcoding", "stylization", "condensation", "summarization", "formatting"],
    forbiddenOperations: ["assume", "infer_missing_facts", "browse", "invent", "speculate"],
    confidenceFloor: minConfidence,
    requireEvidenceBinding: true,
  };

  const validationResult = await antiHallucination.parseAndValidateOutput(
    rawContent,
    factPack,
    contract
  );

  if (validationResult.abortTriggered) {
    console.warn(`[FactValidation] Validation aborted: ${validationResult.abortReason}`);
    return {
      isValid: false,
      validatedContent: rawContent,
      validationResult,
      factPack,
      gapReport: validationResult.gapReport ? {
        status: "INSUFFICIENT_DATA",
        missing: validationResult.gapReport.missingFactTypes,
        suggestedActions: validationResult.gapReport.suggestedActions,
      } : undefined,
    };
  }

  const validatedContent = antiHallucination.rebuildContentFromValidClaims(validationResult.validatedClaims);

  if (contentId) {
    await antiHallucination.saveClaimsToDatabase(
      contentType,
      contentId,
      teamId,
      validationResult,
      `${contentType}-fact-validator`
    );

    await antiHallucination.createAuditTrail(
      contentType,
      contentId,
      teamId,
      factPack,
      validationResult,
      [`${contentType}-generator`, "fact-validator"],
      GEMINI_FLASH_MODEL,
      minConfidence
    );
  }

  console.log(`[FactValidation] Complete. Safety: ${validationResult.safetyScore}%, Valid: ${validationResult.validatedClaims.length}, Rejected: ${validationResult.rejectedClaims.length}`);

  return {
    isValid: validationResult.isValid,
    validatedContent,
    validationResult,
    factPack,
  };
}

export async function generateWithFactValidation(
  basePrompt: string,
  contentType: "article" | "social" | "video" | "podcast",
  options: FactValidationOptions
): Promise<VerifiedGenerationResult> {
  const {
    teamId,
    enableFactValidation = true,
    minConfidence = DEFAULT_CONFIDENCE_THRESHOLDS[contentType],
    entityTypes,
    categories,
    topic,
    contentId,
  } = options;

  return generateVerifiedContent(basePrompt, {
    teamId,
    contentType,
    contentId,
    topic,
    entityTypes,
    categories,
    minConfidence,
    skipVerification: !enableFactValidation,
  });
}

export async function ingestFactsFromResearch(
  teamId: number,
  researchData: {
    facts: Array<{
      text: string;
      source: string;
      sourceUrl?: string;
      confidence?: number;
      entityType?: string;
      entityName?: string;
      category?: string;
    }>;
  },
  verifierId?: number
): Promise<{ created: number; failed: number; errors: string[] }> {
  console.log(`[FactIngestion] Ingesting ${researchData.facts.length} facts for team ${teamId}`);
  
  let created = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const fact of researchData.facts) {
    try {
      await factStore.createFact({
        teamId,
        factText: fact.text,
        sourceType: fact.source.includes("http") ? "website" : "document",
        sourceUrl: fact.sourceUrl,
        confidence: fact.confidence ?? 70,
        entityType: fact.entityType,
        entityName: fact.entityName,
        category: fact.category,
        verifiedBy: "ai_research",
        verifierId,
      });
      created++;
    } catch (error) {
      failed++;
      errors.push(`Failed to create fact "${fact.text.substring(0, 50)}...": ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  console.log(`[FactIngestion] Complete. Created: ${created}, Failed: ${failed}`);
  return { created, failed, errors };
}

export async function extractFactsFromContent(
  content: string,
  teamId: number,
  options: {
    entityType?: string;
    entityName?: string;
    category?: string;
    minConfidence?: number;
  } = {}
): Promise<Array<{
  factText: string;
  confidence: number;
  sourceExcerpt: string;
}>> {
  console.log(`[FactExtraction] Extracting facts from content for team ${teamId}`);

  const extractionPrompt = `Analyze the following content and extract verifiable factual claims.

For each fact:
1. Extract the exact factual claim (not opinions or subjective statements)
2. Assign a confidence score (0-100) based on how verifiable the claim is
3. Include the source excerpt where the fact appears

Only extract claims that could be verified through research. Exclude:
- Opinions or subjective assessments
- Marketing language or promotional claims
- Speculative statements
- Industry generalizations without specific data

Content to analyze:
${content}

Return JSON:
{
  "facts": [
    {
      "factText": "The specific factual claim",
      "confidence": 80,
      "sourceExcerpt": "The exact text from content containing this fact"
    }
  ]
}`;

  try {
    const response = await callGeminiWithRetry(extractionPrompt, { 
      model: GEMINI_FLASH_MODEL,
      responseFormat: "json"
    });

    const parsed = JSON.parse(response);
    const facts = parsed.facts || [];

    console.log(`[FactExtraction] Extracted ${facts.length} facts`);
    return facts.filter((f: any) => f.confidence >= (options.minConfidence ?? 60));
  } catch (error) {
    console.error(`[FactExtraction] Failed:`, error);
    return [];
  }
}

export async function getFactCoverageReport(
  teamId: number,
  topic?: string,
  entityTypes?: string[]
): Promise<{
  totalFacts: number;
  byEntityType: Record<string, number>;
  byCategory: Record<string, number>;
  averageConfidence: number;
  expiringFacts: number;
  lowConfidenceFacts: number;
  recommendations: string[];
}> {
  const factPack = await antiHallucination.getFactPackForGeneration({
    teamId,
    contentType: "article",
    topic,
    entityTypes,
    minConfidence: 0,
  });

  const byEntityType: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalConfidence = 0;
  let expiringFacts = 0;
  let lowConfidenceFacts = 0;

  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  for (const fact of factPack.facts) {
    const entityType = fact.entityType || "unclassified";
    byEntityType[entityType] = (byEntityType[entityType] || 0) + 1;

    const category = fact.category || "uncategorized";
    byCategory[category] = (byCategory[category] || 0) + 1;

    totalConfidence += fact.confidence;

    if (fact.expiresAt && new Date(fact.expiresAt) < thirtyDaysFromNow) {
      expiringFacts++;
    }

    if (fact.confidence < 70) {
      lowConfidenceFacts++;
    }
  }

  const recommendations: string[] = [];

  if (factPack.totalCount === 0) {
    recommendations.push("No facts found. Add verified facts using /api/facts before generating content.");
  } else if (factPack.totalCount < 10) {
    recommendations.push("Low fact count. Consider adding more verified facts for comprehensive content coverage.");
  }

  if (lowConfidenceFacts > factPack.totalCount * 0.3) {
    recommendations.push("Many low-confidence facts. Review and verify sources to improve confidence scores.");
  }

  if (expiringFacts > 0) {
    recommendations.push(`${expiringFacts} fact(s) expiring within 30 days. Schedule review and updates.`);
  }

  if (Object.keys(byEntityType).length < 3) {
    recommendations.push("Limited entity type coverage. Add facts for more entity types to improve content diversity.");
  }

  return {
    totalFacts: factPack.totalCount,
    byEntityType,
    byCategory,
    averageConfidence: factPack.totalCount > 0 ? Math.round(totalConfidence / factPack.totalCount) : 0,
    expiringFacts,
    lowConfidenceFacts,
    recommendations,
  };
}
