import { GEMINI_FLASH_MODEL } from "./ai-config";
/**
 * ============================================================================
 * REFLEXIVE ARTICLE GENERATION MODULE
 * ============================================================================
 * 
 * Implements a multi-pass article generation system with self-correction:
 * 
 * 1. DRAFT PASS: Generate initial article using Gemini
 * 2. VALIDATE: Check for promotional language violations and AI clichés
 * 3. REWRITE (if needed): Use AI to remove violations while preserving content
 * 4. FINAL VALIDATION: Confirm clean output
 * 
 * This prevents promotional/advertising language from appearing in educational content.
 */

import { GoogleGenAI } from "@google/genai";
import { 
  parseArticleSections, 
  validatePromotionalContent, 
  detectAIClichesWithContext,
  type ArticleSection,
  type PromotionalValidationResult,
  type PromotionalViolation
} from "./article-critique";

export interface ReflexiveGenerationResult {
  content: string;
  wasRewritten: boolean;
  passCount: number;
  initialViolations: PromotionalViolation[];
  finalViolations: PromotionalViolation[];
  clichesRemoved: string[];
  sections: ArticleSection[];
  qualityMetrics: {
    promoFreeScore: number;
    educationalTone: boolean;
    ctaContained: boolean;
  };
}

export interface ReflexiveGenerationOptions {
  maxPasses?: number;
  strictMode?: boolean;
  skipRewrite?: boolean;
}

const DEFAULT_OPTIONS: ReflexiveGenerationOptions = {
  maxPasses: 2,
  strictMode: true,
  skipRewrite: false
};

/**
 * Validate article content for promotional language and AI clichés
 * Returns validation result with section-aware violations
 */
export function validateArticleContent(
  content: string,
  companyName: string
): {
  promoValidation: PromotionalValidationResult;
  clicheResults: { cliche: string; inCTA: boolean; count: number }[];
  sections: ArticleSection[];
  needsRewrite: boolean;
} {
  const sections = parseArticleSections(content);
  const promoValidation = validatePromotionalContent(content, companyName, sections);
  const clicheResults = detectAIClichesWithContext(content, sections);
  
  const needsRewrite = !promoValidation.isClean || 
    clicheResults.some(c => !c.inCTA && c.count > 0);
  
  return {
    promoValidation,
    clicheResults,
    sections,
    needsRewrite
  };
}

/**
 * Generate a reflexive rewrite prompt to fix violations
 */
function buildRewritePrompt(
  content: string,
  violations: PromotionalViolation[],
  cliches: { cliche: string; inCTA: boolean; count: number }[],
  companyName: string
): string {
  const violationList = violations.map(v => 
    `- "${v.phrase}" in ${v.sectionType} section: ${v.context}`
  ).join('\n');
  
  const clicheList = cliches
    .filter(c => !c.inCTA && c.count > 0)
    .map(c => `- "${c.cliche}" (found ${c.count} times)`)
    .join('\n');

  return `You are a Senior Editor tasked with removing promotional and AI-generated language from an educational article.

VIOLATIONS FOUND:
${violationList || 'None'}

AI CLICHÉS TO REMOVE:
${clicheList || 'None'}

COMPANY NAME: ${companyName}

RULES FOR REWRITING:
1. REMOVE all promotional language from introduction and body sections
2. REMOVE all AI clichés throughout the article
3. KEEP the company name "${companyName}" ONLY in the conclusion/CTA section
4. PRESERVE the article structure, headings, and word count
5. MAINTAIN the educational, informational tone
6. REPLACE promotional phrases with neutral, educational language:
   - "Our team provides" → "Licensed professionals offer"
   - "We are the leading provider" → "Providers in the area offer"
   - "Choose us for" → "When selecting a provider, consider"
7. DO NOT add new promotional content
8. DO NOT change the meaning or factual content

ARTICLE TO REWRITE:
${content}

Return ONLY the rewritten article in Markdown format.
Do NOT include explanations, meta-commentary, or JSON wrappers.`;
}

/**
 * Perform reflexive rewrite using Gemini
 */
async function performReflexiveRewrite(
  content: string,
  violations: PromotionalViolation[],
  cliches: { cliche: string; inCTA: boolean; count: number }[],
  companyName: string,
  geminiApiKey: string
): Promise<string> {
  const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
  
  const prompt = buildRewritePrompt(content, violations, cliches, companyName);
  
  console.log(`🔄 Performing reflexive rewrite to fix ${violations.length} violations and ${cliches.length} clichés...`);
  
  const result = await genAI.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { 
      temperature: 0.2,
      maxOutputTokens: 8192
    }
  });
  
  const rewrittenContent = result.text || '';
  
  if (!rewrittenContent || rewrittenContent.length < content.length * 0.5) {
    console.warn('⚠️ Rewrite produced insufficient content, keeping original');
    return content;
  }
  
  return rewrittenContent;
}

/**
 * Main entry point: Generate article with reflexive self-correction
 * 
 * This wraps the standard article generation with validation and optional rewrite passes
 * to ensure promotional content only appears in the conclusion/CTA section.
 */
export async function generateArticleReflexive(
  generatedContent: string,
  companyName: string,
  options: ReflexiveGenerationOptions = {}
): Promise<ReflexiveGenerationResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  console.log('🔍 Starting reflexive article validation...');
  
  let currentContent = generatedContent;
  let passCount = 0;
  let wasRewritten = false;
  let initialViolations: PromotionalViolation[] = [];
  let clichesRemoved: string[] = [];
  
  // Pass 1: Initial validation
  passCount++;
  const initialValidation = validateArticleContent(currentContent, companyName);
  initialViolations = initialValidation.promoValidation.violations;
  
  console.log(`📊 Pass ${passCount} validation: ${initialViolations.length} violations, ${initialValidation.clicheResults.filter(c => c.count > 0).length} clichés`);
  
  // If clean or no Gemini API key or skip rewrite, return as-is
  if (!initialValidation.needsRewrite || !geminiApiKey || opts.skipRewrite) {
    console.log('✅ Article passed validation without rewrite needed');
    return {
      content: currentContent,
      wasRewritten: false,
      passCount,
      initialViolations,
      finalViolations: initialViolations,
      clichesRemoved: [],
      sections: initialValidation.sections,
      qualityMetrics: calculateQualityMetrics(initialValidation)
    };
  }
  
  // Pass 2: Reflexive rewrite
  if (initialValidation.needsRewrite && passCount < opts.maxPasses!) {
    passCount++;
    
    try {
      currentContent = await performReflexiveRewrite(
        currentContent,
        initialValidation.promoValidation.violations,
        initialValidation.clicheResults,
        companyName,
        geminiApiKey
      );
      wasRewritten = true;
      
      clichesRemoved = initialValidation.clicheResults
        .filter(c => c.count > 0)
        .map(c => c.cliche);
      
    } catch (error) {
      console.warn('⚠️ Reflexive rewrite failed, using original content:', (error as Error).message);
    }
  }
  
  // Final validation
  const finalValidation = validateArticleContent(currentContent, companyName);
  
  console.log(`📊 Final validation: ${finalValidation.promoValidation.violations.length} violations remaining`);
  
  if (wasRewritten && finalValidation.promoValidation.violations.length < initialViolations.length) {
    console.log(`✅ Reflexive rewrite reduced violations from ${initialViolations.length} to ${finalValidation.promoValidation.violations.length}`);
  }
  
  return {
    content: currentContent,
    wasRewritten,
    passCount,
    initialViolations,
    finalViolations: finalValidation.promoValidation.violations,
    clichesRemoved,
    sections: finalValidation.sections,
    qualityMetrics: calculateQualityMetrics(finalValidation)
  };
}

/**
 * Calculate quality metrics from validation results
 */
function calculateQualityMetrics(
  validation: ReturnType<typeof validateArticleContent>
): ReflexiveGenerationResult['qualityMetrics'] {
  const { promoValidation, sections } = validation;
  
  const promoFreeScore = promoValidation.isClean 
    ? 100 
    : Math.max(0, 100 - promoValidation.violations.length * 10);
  
  const educationalTone = 
    promoValidation.firstPersonPromoCount === 0 &&
    promoValidation.marketingSuperlativeCount === 0;
  
  const ctaSections = sections.filter(s => s.allowPromotionalContent);
  const ctaContained = promoValidation.companyMentionsOutsideCTA === 0 && ctaSections.length > 0;
  
  return {
    promoFreeScore,
    educationalTone,
    ctaContained
  };
}

/**
 * Quick validation check - use when you just want to check content
 * without doing a full rewrite pass
 */
export function quickValidateContent(
  content: string,
  companyName: string
): {
  isClean: boolean;
  violationCount: number;
  summary: string;
} {
  const validation = validateArticleContent(content, companyName);
  
  const violationCount = validation.promoValidation.violations.length;
  const clicheCount = validation.clicheResults.filter(c => c.count > 0 && !c.inCTA).length;
  
  let summary = '';
  if (validation.promoValidation.isClean && clicheCount === 0) {
    summary = 'Content is clean - no promotional language or AI clichés detected outside CTA';
  } else {
    const issues: string[] = [];
    if (violationCount > 0) issues.push(`${violationCount} promotional violations`);
    if (clicheCount > 0) issues.push(`${clicheCount} AI clichés`);
    if (validation.promoValidation.companyMentionsOutsideCTA > 0) {
      issues.push(`${validation.promoValidation.companyMentionsOutsideCTA} company mentions outside CTA`);
    }
    summary = `Issues found: ${issues.join(', ')}`;
  }
  
  return {
    isClean: validation.promoValidation.isClean && clicheCount === 0,
    violationCount: violationCount + clicheCount,
    summary
  };
}
