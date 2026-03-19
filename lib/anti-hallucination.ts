import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { GoogleGenAI } from "@google/genai";
import {
  factClaims,
  contentAuditTrails,
  agentExecutionManifests,
  InsertFactClaim,
  InsertContentAuditTrail,
  InsertAgentExecutionManifest,
  ClaimClass,
  ValidationStatus,
} from "../shared/schema";
import { factStore, FactPack } from "./fact-store";
import { GEMINI_FLASH_MODEL } from "./ai-config";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function callGeminiForValidation(prompt: string): Promise<string> {
  const result = await genAI.models.generateContent({
    model: GEMINI_FLASH_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  return result.text || "";
}

const REJECTED_CLAIM_CLASSES = [ClaimClass.ASSUMPTION, ClaimClass.GUESS, ClaimClass.INDUSTRY_GENERIC];

export interface AgentContract {
  teamId: number;
  agentName: string;
  contentType: string;
  allowedOperations: string[];
  forbiddenOperations: string[];
  confidenceFloor: number;
  maxFactsPerClaim?: number;
  requireEvidenceBinding?: boolean;
}

export interface ClaimWithBinding {
  sentenceIndex: number;
  claimText: string;
  factIds: number[];
  claimClass: string;
  confidence: number;
}

export interface ValidationResult {
  isValid: boolean;
  validatedClaims: ClaimWithBinding[];
  rejectedClaims: ClaimWithBinding[];
  insufficientDataClaims: string[];
  gapReport: GapReport | null;
  safetyScore: number;
  abortTriggered: boolean;
  abortReason?: string;
}

export interface GapReport {
  status: "INSUFFICIENT_DATA";
  missingFactTypes: string[];
  missingEntities: string[];
  suggestedActions: string[];
}

export interface GenerationContext {
  teamId: number;
  contentType: string;
  contentId?: number;
  topic?: string;
  entityTypes?: string[];
  categories?: string[];
  minConfidence?: number;
}

export interface StructuredOutput {
  sentences: Array<{
    index: number;
    text: string;
    factRefs: string[];
    claimType: string;
  }>;
  insufficientData?: string[];
  content?: string;
}

class AntiHallucinationService {
  async createAgentManifest(contract: AgentContract): Promise<string> {
    const executionId = uuidv4();
    
    await db.insert(agentExecutionManifests).values({
      teamId: contract.teamId,
      agentName: contract.agentName,
      contentType: contract.contentType,
      allowedOperations: contract.allowedOperations,
      forbiddenOperations: contract.forbiddenOperations,
      confidenceFloor: contract.confidenceFloor,
      maxFactsPerClaim: contract.maxFactsPerClaim ?? 5,
      requireEvidenceBinding: contract.requireEvidenceBinding !== false ? 1 : 0,
      executionId: executionId,
      status: "executing",
    });

    console.log(`[AntiHallucination] Created manifest ${executionId} for ${contract.agentName}`);
    return executionId;
  }

  async completeManifest(executionId: string, violations: number, details?: any): Promise<void> {
    await db.update(agentExecutionManifests)
      .set({
        status: violations > 0 ? "aborted" : "completed",
        violationsDetected: violations,
        violationDetails: details,
        completedAt: new Date(),
      })
      .where(eq(agentExecutionManifests.executionId, executionId));
  }

  async getFactPackForGeneration(context: GenerationContext): Promise<FactPack> {
    return factStore.getFactPack(context.teamId, {
      entityTypes: context.entityTypes,
      categories: context.categories,
      minConfidence: context.minConfidence ?? 70,
      limit: 100,
    });
  }

  buildPromptWithFacts(basePrompt: string, factPack: FactPack, contract: AgentContract): string {
    const factSection = factStore.formatFactsForPrompt(factPack);
    
    const contractSection = `
=== AGENT CONTRACT ===
ALLOWED OPERATIONS: ${contract.allowedOperations.join(", ")}
FORBIDDEN OPERATIONS: ${contract.forbiddenOperations.join(", ")} (these will cause REJECTION)
MINIMUM CONFIDENCE: ${contract.confidenceFloor}%

OUTPUT REQUIREMENTS:
You MUST return a JSON object with this structure:
{
  "sentences": [
    {
      "index": 0,
      "text": "The actual sentence text",
      "factRefs": ["F123", "F456"],
      "claimType": "direct_fact|rephrase|derived"
    }
  ],
  "insufficientData": ["description of what data is missing"] // only if facts are missing
}

CRITICAL RULES:
- Every sentence containing a factual claim MUST include factRefs
- factRefs must reference fact IDs from the VERIFIED FACT STORE above
- If you cannot support a claim with facts, add it to insufficientData instead
- NEVER guess, assume, or use industry generalizations
- claimType must be one of: direct_fact, rephrase, derived (NOT assumption, guess, or industry_generic)
=== END CONTRACT ===

`;

    return `${factSection}\n\n${contractSection}\n\n${basePrompt}`;
  }

  async parseAndValidateOutput(
    rawOutput: string,
    factPack: FactPack,
    contract: AgentContract
  ): Promise<ValidationResult> {
    const validatedClaims: ClaimWithBinding[] = [];
    const rejectedClaims: ClaimWithBinding[] = [];
    const insufficientDataClaims: string[] = [];
    let abortTriggered = false;
    let abortReason: string | undefined;

    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          isValid: false,
          validatedClaims: [],
          rejectedClaims: [],
          insufficientDataClaims: [],
          gapReport: null,
          safetyScore: 0,
          abortTriggered: true,
          abortReason: "Output is not valid JSON with evidence bindings",
        };
      }

      const parsed: StructuredOutput = JSON.parse(jsonMatch[0]);
      const factIds = new Set(factPack.facts.map(f => f.id));

      if (parsed.insufficientData && parsed.insufficientData.length > 0) {
        insufficientDataClaims.push(...parsed.insufficientData);
      }

      for (const sentence of parsed.sentences || []) {
        const extractedFactIds = (sentence.factRefs || [])
          .map(ref => {
            const match = ref.match(/F?(\d+)/i);
            return match ? parseInt(match[1], 10) : null;
          })
          .filter((id): id is number => id !== null);

        const validFactIds = extractedFactIds.filter(id => factIds.has(id));
        const invalidFactIds = extractedFactIds.filter(id => !factIds.has(id));

        if (invalidFactIds.length > 0) {
          console.warn(`[AntiHallucination] Invalid fact references: ${invalidFactIds.join(", ")}`);
        }

        const referencedFacts = factPack.facts.filter(f => validFactIds.includes(f.id));
        const avgConfidence = referencedFacts.length > 0
          ? Math.round(referencedFacts.reduce((sum, f) => sum + f.confidence, 0) / referencedFacts.length)
          : 0;

        const claim: ClaimWithBinding = {
          sentenceIndex: sentence.index,
          claimText: sentence.text,
          factIds: validFactIds,
          claimClass: sentence.claimType || ClaimClass.ASSUMPTION,
          confidence: avgConfidence,
        };

        const isRejectedClass = REJECTED_CLAIM_CLASSES.includes(claim.claimClass as any);
        const hasNoEvidence = validFactIds.length === 0 && this.containsFactualClaim(sentence.text);
        const belowConfidenceFloor = avgConfidence < contract.confidenceFloor && validFactIds.length > 0;

        if (isRejectedClass) {
          claim.claimClass = ClaimClass.ASSUMPTION;
          rejectedClaims.push(claim);
        } else if (hasNoEvidence) {
          claim.claimClass = ClaimClass.ASSUMPTION;
          rejectedClaims.push(claim);
        } else if (belowConfidenceFloor) {
          rejectedClaims.push(claim);
        } else {
          validatedClaims.push(claim);
        }
      }

      if (rejectedClaims.length > validatedClaims.length) {
        abortTriggered = true;
        abortReason = `Too many rejected claims (${rejectedClaims.length}/${validatedClaims.length + rejectedClaims.length})`;
      }

    } catch (error) {
      console.error("[AntiHallucination] Parse error:", error);
      return {
        isValid: false,
        validatedClaims: [],
        rejectedClaims: [],
        insufficientDataClaims: [],
        gapReport: null,
        safetyScore: 0,
        abortTriggered: true,
        abortReason: `Failed to parse output: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }

    const totalClaims = validatedClaims.length + rejectedClaims.length;
    const safetyScore = totalClaims > 0
      ? Math.round((validatedClaims.length / totalClaims) * 100)
      : 100;

    let gapReport: GapReport | null = null;
    if (insufficientDataClaims.length > 0) {
      gapReport = {
        status: "INSUFFICIENT_DATA",
        missingFactTypes: insufficientDataClaims,
        missingEntities: [],
        suggestedActions: ["Add verified facts to the fact store for the missing information"],
      };
    }

    return {
      isValid: !abortTriggered && rejectedClaims.length === 0,
      validatedClaims,
      rejectedClaims,
      insufficientDataClaims,
      gapReport,
      safetyScore,
      abortTriggered,
      abortReason,
    };
  }

  private containsFactualClaim(text: string): boolean {
    const factualIndicators = [
      /\b(is|are|was|were|has|have|had|provides?|offers?|operates?|serves?)\b/i,
      /\b(located|based|founded|established)\b/i,
      /\b\d+%|\$\d+|\d+ (years?|employees?|locations?|customers?)/i,
      /\b(always|never|every|all|none)\b/i,
    ];

    const nonFactualPatterns = [
      /^(you|we|they) (can|could|should|might|may)/i,
      /\b(perhaps|maybe|possibly|likely|probably)\b/i,
      /\?$/,
    ];

    for (const pattern of nonFactualPatterns) {
      if (pattern.test(text)) return false;
    }

    for (const pattern of factualIndicators) {
      if (pattern.test(text)) return true;
    }

    return false;
  }

  async saveClaimsToDatabase(
    contentType: string,
    contentId: number,
    teamId: number,
    validationResult: ValidationResult,
    validatorAgent: string
  ): Promise<void> {
    const allClaims = [
      ...validationResult.validatedClaims.map(c => ({
        ...c,
        validationStatus: ValidationStatus.APPROVED,
        rejectionReason: null,
      })),
      ...validationResult.rejectedClaims.map(c => ({
        ...c,
        validationStatus: ValidationStatus.REJECTED,
        rejectionReason: `Claim class: ${c.claimClass}, Confidence: ${c.confidence}`,
      })),
    ];

    for (const claim of allClaims) {
      await db.insert(factClaims).values({
        contentType,
        contentId,
        teamId,
        sentenceIndex: claim.sentenceIndex,
        claimText: claim.claimText,
        factIds: claim.factIds,
        claimClass: claim.claimClass,
        confidence: claim.confidence,
        validationStatus: claim.validationStatus,
        validatorAgent,
        rejectionReason: claim.rejectionReason,
      });
    }

    console.log(`[AntiHallucination] Saved ${allClaims.length} claims for ${contentType}:${contentId}`);
  }

  async createAuditTrail(
    contentType: string,
    contentId: number,
    teamId: number,
    factPack: FactPack,
    validationResult: ValidationResult,
    agentsInvolved: string[],
    generatorModel: string,
    confidenceThreshold: number
  ): Promise<void> {
    const usedFactIds = new Set<number>();
    for (const claim of validationResult.validatedClaims) {
      claim.factIds.forEach(id => usedFactIds.add(id));
    }

    const confidences = validationResult.validatedClaims
      .filter(c => c.factIds.length > 0)
      .map(c => c.confidence);

    await db.insert(contentAuditTrails).values({
      contentType,
      contentId,
      teamId,
      factsUsed: Array.from(usedFactIds),
      factsRequested: factPack.totalCount,
      factsCovered: usedFactIds.size,
      avgConfidence: confidences.length > 0
        ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
        : 0,
      minConfidence: confidences.length > 0 ? Math.min(...confidences) : 0,
      confidenceThreshold,
      totalClaims: validationResult.validatedClaims.length + validationResult.rejectedClaims.length,
      approvedClaims: validationResult.validatedClaims.length,
      rejectedClaims: validationResult.rejectedClaims.length,
      insufficientDataClaims: validationResult.insufficientDataClaims.length,
      missingFactTypes: validationResult.gapReport?.missingFactTypes,
      gapReport: validationResult.gapReport,
      agentsInvolved,
      generatorModel,
      validatorModel: "anti-hallucination-v1",
      safetyScore: validationResult.safetyScore,
      abortTriggered: validationResult.abortTriggered ? 1 : 0,
      abortReason: validationResult.abortReason,
    });

    console.log(`[AntiHallucination] Created audit trail for ${contentType}:${contentId}, safety: ${validationResult.safetyScore}%`);
  }

  async classifyClaims(text: string, factPack: FactPack): Promise<StructuredOutput> {
    const prompt = `You are a claim classifier. Analyze the following text and classify each sentence.

AVAILABLE FACTS:
${factStore.formatFactsForPrompt(factPack)}

TEXT TO ANALYZE:
${text}

For each sentence, determine:
1. Is it a direct quote of a fact? (direct_fact)
2. Is it a rephrase of a fact? (rephrase)
3. Is it derived from combining facts? (derived)
4. Is it an assumption/guess? (assumption - this should be flagged)
5. Is it generic industry knowledge? (industry_generic - this should be flagged)

Return JSON:
{
  "sentences": [
    {"index": 0, "text": "sentence text", "factRefs": ["F123"], "claimType": "direct_fact|rephrase|derived|assumption|industry_generic"}
  ]
}`;

    try {
      const result = await callGeminiForValidation(prompt);
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error("[AntiHallucination] Classification error:", error);
    }

    return { sentences: [], insufficientData: ["Classification failed"] };
  }

  rebuildContentFromValidClaims(validatedClaims: ClaimWithBinding[]): string {
    return validatedClaims
      .sort((a, b) => a.sentenceIndex - b.sentenceIndex)
      .map(c => c.claimText)
      .join(" ");
  }

  formatInsufficientDataResponse(gapReport: GapReport): string {
    return JSON.stringify({
      status: gapReport.status,
      missing: gapReport.missingFactTypes,
      suggestedActions: gapReport.suggestedActions,
    }, null, 2);
  }
}

export const antiHallucination = new AntiHallucinationService();
