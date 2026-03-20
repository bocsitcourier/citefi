import { factStore, FactPack } from "./fact-store";
import { GoogleGenAI } from "@google/genai";
import {
  antiHallucination,
  AgentContract,
  ValidationResult,
  GenerationContext,
  ClaimWithBinding,
} from "./anti-hallucination";
import { GEMINI_FLASH_MODEL } from "./ai-config";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function callGeminiWithRetry(prompt: string, options?: { model?: string; responseFormat?: string }): Promise<string> {
  const result = await genAI.models.generateContent({
    model: options?.model || GEMINI_FLASH_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  return result.text || "";
}

export interface VerifiedGenerationOptions {
  teamId: number;
  contentType: "article" | "social" | "video" | "podcast";
  contentId?: number;
  topic?: string;
  entityTypes?: string[];
  categories?: string[];
  minConfidence?: number;
  allowedOperations?: string[];
  skipVerification?: boolean;
}

export interface VerifiedGenerationResult {
  success: boolean;
  content: string | null;
  validationResult: ValidationResult | null;
  factPack: FactPack;
  executionId: string | null;
  gapReport?: {
    status: "INSUFFICIENT_DATA";
    missing: string[];
    suggestedActions: string[];
  };
}

const DEFAULT_ALLOWED_OPERATIONS = ["transcoding", "stylization", "condensation", "summarization", "formatting"];
const DEFAULT_FORBIDDEN_OPERATIONS = ["assume", "infer_missing_facts", "browse", "invent", "speculate"];

export async function generateVerifiedContent(
  basePrompt: string,
  options: VerifiedGenerationOptions
): Promise<VerifiedGenerationResult> {
  const {
    teamId,
    contentType,
    contentId,
    topic,
    entityTypes,
    categories,
    minConfidence = 70,
    allowedOperations = DEFAULT_ALLOWED_OPERATIONS,
    skipVerification = false,
  } = options;

  console.log(`[VerifiedGenerator] Starting ${contentType} generation for team ${teamId}${skipVerification ? " (verification skipped)" : ""}`);

  const factPack = await antiHallucination.getFactPackForGeneration({
    teamId,
    contentType,
    contentId,
    topic,
    entityTypes,
    categories,
    minConfidence,
  });

  console.log(`[VerifiedGenerator] Loaded ${factPack.totalCount} facts (confidence ${factPack.confidenceRange.min}-${factPack.confidenceRange.max}%)`);

  if (factPack.facts.length === 0 && !skipVerification) {
    console.warn(`[VerifiedGenerator] No facts available for team ${teamId}`);
    return {
      success: false,
      content: null,
      validationResult: null,
      factPack,
      executionId: null,
      gapReport: {
        status: "INSUFFICIENT_DATA",
        missing: ["No verified facts found in the fact store"],
        suggestedActions: ["Add verified facts to the fact store before generating content"],
      },
    };
  }

  const contract: AgentContract = {
    teamId,
    agentName: `${contentType}-generator`,
    contentType,
    allowedOperations,
    forbiddenOperations: DEFAULT_FORBIDDEN_OPERATIONS,
    confidenceFloor: minConfidence,
    requireEvidenceBinding: !skipVerification,
  };

  let executionId: string | null = null;
  
  if (!skipVerification) {
    executionId = await antiHallucination.createAgentManifest(contract);
  }

  try {
    let enhancedPrompt = basePrompt;
    
    if (!skipVerification && factPack.facts.length > 0) {
      enhancedPrompt = antiHallucination.buildPromptWithFacts(basePrompt, factPack, contract);
    }

    console.log(`[VerifiedGenerator] Calling Gemini for ${contentType} generation...`);
    const rawOutput = await callGeminiWithRetry(enhancedPrompt, { model: GEMINI_FLASH_MODEL });

    if (skipVerification) {
      console.log(`[VerifiedGenerator] Verification skipped, returning raw output`);
      return {
        success: true,
        content: rawOutput,
        validationResult: null,
        factPack,
        executionId,
      };
    }

    const validationResult = await antiHallucination.parseAndValidateOutput(
      rawOutput,
      factPack,
      contract
    );

    if (validationResult.abortTriggered) {
      console.warn(`[VerifiedGenerator] Generation aborted: ${validationResult.abortReason}`);
      if (executionId) {
        await antiHallucination.completeManifest(executionId, 1, { abortReason: validationResult.abortReason });
      }
      return {
        success: false,
        content: null,
        validationResult,
        factPack,
        executionId,
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
        "verified-content-generator"
      );

      await antiHallucination.createAuditTrail(
        contentType,
        contentId,
        teamId,
        factPack,
        validationResult,
        ["verified-content-generator", "anti-hallucination"],
        GEMINI_FLASH_MODEL,
        minConfidence
      );
    }

    if (executionId) {
      await antiHallucination.completeManifest(
        executionId,
        validationResult.rejectedClaims.length,
        { 
          approved: validationResult.validatedClaims.length,
          rejected: validationResult.rejectedClaims.length,
          safetyScore: validationResult.safetyScore,
        }
      );
    }

    console.log(`[VerifiedGenerator] Generation complete. Safety: ${validationResult.safetyScore}%, Approved: ${validationResult.validatedClaims.length}, Rejected: ${validationResult.rejectedClaims.length}`);

    return {
      success: validationResult.isValid,
      content: validatedContent,
      validationResult,
      factPack,
      executionId,
    };

  } catch (error) {
    console.error(`[VerifiedGenerator] Generation error:`, error);
    if (executionId) {
      await antiHallucination.completeManifest(executionId, 1, { error: error instanceof Error ? error.message : "Unknown" });
    }
    throw error;
  }
}

export async function validateExistingContent(
  content: string,
  options: VerifiedGenerationOptions
): Promise<ValidationResult> {
  const factPack = await antiHallucination.getFactPackForGeneration({
    teamId: options.teamId,
    contentType: options.contentType,
    contentId: options.contentId,
    entityTypes: options.entityTypes,
    categories: options.categories,
    minConfidence: options.minConfidence ?? 70,
  });

  const classified = await antiHallucination.classifyClaims(content, factPack);

  const contract: AgentContract = {
    teamId: options.teamId,
    agentName: "content-validator",
    contentType: options.contentType,
    allowedOperations: DEFAULT_ALLOWED_OPERATIONS,
    forbiddenOperations: DEFAULT_FORBIDDEN_OPERATIONS,
    confidenceFloor: options.minConfidence ?? 70,
  };

  const validatedClaims: ClaimWithBinding[] = [];
  const rejectedClaims: ClaimWithBinding[] = [];
  const insufficientDataClaims: string[] = [];

  const factIds = new Set(factPack.facts.map(f => f.id));

  for (const sentence of classified.sentences) {
    const extractedFactIds = (sentence.factRefs || [])
      .map(ref => {
        const match = ref.match(/F?(\d+)/i);
        return match ? parseInt(match[1]!, 10) : null;
      })
      .filter((id): id is number => id !== null && factIds.has(id));

    const referencedFacts = factPack.facts.filter(f => extractedFactIds.includes(f.id));
    const avgConfidence = referencedFacts.length > 0
      ? Math.round(referencedFacts.reduce((sum, f) => sum + f.confidence, 0) / referencedFacts.length)
      : 0;

    const claim: ClaimWithBinding = {
      sentenceIndex: sentence.index,
      claimText: sentence.text,
      factIds: extractedFactIds,
      claimClass: sentence.claimType,
      confidence: avgConfidence,
    };

    const isRejectedClass = ["assumption", "guess", "industry_generic"].includes(sentence.claimType);
    
    if (isRejectedClass || (extractedFactIds.length === 0 && avgConfidence < contract.confidenceFloor)) {
      rejectedClaims.push(claim);
    } else {
      validatedClaims.push(claim);
    }
  }

  if (classified.insufficientData) {
    insufficientDataClaims.push(...classified.insufficientData);
  }

  const totalClaims = validatedClaims.length + rejectedClaims.length;
  const safetyScore = totalClaims > 0 ? Math.round((validatedClaims.length / totalClaims) * 100) : 100;

  return {
    isValid: rejectedClaims.length === 0,
    validatedClaims,
    rejectedClaims,
    insufficientDataClaims,
    gapReport: insufficientDataClaims.length > 0 ? {
      status: "INSUFFICIENT_DATA",
      missingFactTypes: insufficientDataClaims,
      missingEntities: [],
      suggestedActions: ["Add missing facts to the fact store"],
    } : null,
    safetyScore,
    abortTriggered: false,
  };
}

export function getDefaultContract(contentType: string, teamId: number): AgentContract {
  return {
    teamId,
    agentName: `${contentType}-generator`,
    contentType,
    allowedOperations: DEFAULT_ALLOWED_OPERATIONS,
    forbiddenOperations: DEFAULT_FORBIDDEN_OPERATIONS,
    confidenceFloor: 70,
    maxFactsPerClaim: 5,
    requireEvidenceBinding: true,
  };
}
