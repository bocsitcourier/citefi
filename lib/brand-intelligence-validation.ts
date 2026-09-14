/**
 * Parse one complete JSON object from a structured model response.
 * Markdown fences are tolerated, but truncation and any second/trailing payload
 * are rejected rather than silently accepting a plausible prefix.
 */
export function parseSingleStructuredObject(text: string): Record<string, any> {
  let input = text.trim();
  if (input.startsWith("```")) {
    input = input.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  }
  if (!input.startsWith("{")) throw new Error("Structured response did not start with a JSON object");

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth < 0) throw new Error("Structured response contains unbalanced JSON");
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0 || depth !== 0 || inString) {
    throw new Error("Structured response contains truncated JSON");
  }
  if (input.slice(end).trim()) {
    throw new Error("Structured response contains trailing content or multiple JSON objects");
  }
  const parsed = JSON.parse(input.slice(0, end));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Structured response must be a JSON object");
  }
  return parsed;
}

function normalizedEvidence(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Approved claims are intentionally stricter than other generated policy text:
 * a generated claim must be a verbatim (normalization-insensitive) source quote.
 * Human-entered claims remain supported through manual overrides.
 */
export function retainSourceSupportedClaims(claims: unknown, sourceText: string): {
  approved: string[];
  rejected: string[];
} {
  const candidates = Array.isArray(claims)
    ? claims.filter((claim): claim is string => typeof claim === "string" && claim.trim().length > 0)
    : [];
  const evidence = normalizedEvidence(sourceText);
  const approved: string[] = [];
  const rejected: string[] = [];
  for (const claim of candidates) {
    const clean = claim.trim();
    const normalized = normalizedEvidence(clean);
    if (normalized.length >= 12 && evidence.includes(normalized)) approved.push(clean);
    else rejected.push(clean);
  }
  return { approved: [...new Set(approved)], rejected: [...new Set(rejected)] };
}

export function criticalProfileIssues(profile: any, sourceText: string): string[] {
  const issues: string[] = [];
  if (!sourceText.trim()) issues.push("required business website could not be fetched or analyzed");
  if (!profile?.brandVoice?.toneAdjectives?.length) issues.push("brand voice is missing");
  if (!profile?.positioning?.uniqueValueProposition?.trim() || !profile?.positioning?.coreServices?.length) {
    issues.push("positioning is missing");
  }
  if (!profile?.targetAudience?.primaryPersona?.trim()) issues.push("target audience is missing");
  if (!profile?.competitiveGaps?.opportunityTopics?.length) issues.push("competitive gap analysis is missing");
  if (!profile?.failureAnalysis?.likelyLossReasons?.length) issues.push("failure analysis is missing");
  if (!profile?.contentOpportunities?.uncoveredTopics?.length) issues.push("content opportunities are missing");
  const policy = profile?.brandPolicyPack;
  if (!policy || (
    !policy.prohibitedClaims?.length &&
    !policy.prohibitedPhrases?.length &&
    !policy.toneLexicon?.approved?.length &&
    !policy.toneLexicon?.offBrand?.length
  )) issues.push("brand policy analysis is missing");
  return issues;
}