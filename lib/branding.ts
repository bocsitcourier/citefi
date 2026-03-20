export interface BrandConfig {
  name: string;
  tagline?: string;
  website?: string;
  phone?: string;
  address?: string;
  spellCheckLock: boolean;
}

export const DEFAULT_BRAND: BrandConfig = {
  name: "Your Company",
  tagline: "Professional Services",
  website: "https://example.com",
  spellCheckLock: true,
};

export function createBrandLockPromptSegment(brandName: string): string {
  if (!brandName || brandName.trim().length === 0) {
    throw new Error(
      "CRITICAL: Brand name is required for brand lock. Cannot generate content without a valid business name. " +
      "This prevents AI hallucination of company names in both text and images."
    );
  }
  
  const trimmedBrand = brandName.trim();
  
  return `
⚠️ CRITICAL BRAND NAME SPELLING LOCK ⚠️
The exact company name is: "${trimmedBrand}"

ABSOLUTE REQUIREMENTS:
- NEVER invent, modify, abbreviate, translate, or change "${trimmedBrand}" in any way
- NEVER autocorrect "${trimmedBrand}" to similar-sounding words
- NEVER use synonyms, variations, or shortened forms
- Use "${trimmedBrand}" EXACTLY as written, character-for-character, throughout all content
- This is a proper brand name that must be preserved exactly as: "${trimmedBrand}"
- If you reference the company, use "${trimmedBrand}" verbatim without any changes

Any deviation from the exact spelling "${trimmedBrand}" is a critical error.
`;
}

export function createImageBrandLockPromptSegment(brandName: string): string {
  if (!brandName || brandName.trim().length === 0) {
    throw new Error(
      "CRITICAL: Brand name is required for image brand lock. Cannot generate images without a valid business name. " +
      "This prevents AI hallucination of company names in generated images."
    );
  }
  
  const trimmedBrand = brandName.trim();
  
  return `
⚠️ CRITICAL IMAGE TEXT ACCURACY REQUIREMENT ⚠️
If this image includes the company name, it MUST be: "${trimmedBrand}"

TEXT RENDERING RULES:
- The ONLY acceptable company name is: "${trimmedBrand}"
- Do NOT invent, change, misspell, abbreviate, or modify "${trimmedBrand}"
- Use "${trimmedBrand}" exactly as shown, character-for-character
- If you cannot render "${trimmedBrand}" with 100% accuracy, leave the text space blank
- NEVER guess at the spelling - use "${trimmedBrand}" exactly or omit text entirely

This is a professional brand name. Any misspelling is unacceptable.
`;
}

// Levenshtein distance for fuzzy matching
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1]!.toLowerCase() === str2[j - 1]!.toLowerCase() ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,      // deletion
        matrix[i]![j - 1]! + 1,      // insertion
        matrix[i - 1]![j - 1]! + cost // substitution
      );
    }
  }

  return matrix[len1]![len2]!;
}

export function validateBrandInOutput(output: string, brandName: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!output || !brandName) {
    return { valid: true, errors: [] };
  }
  
  const normalizedBrandName = brandName.trim();
  
  if (normalizedBrandName.length === 0) {
    return { valid: true, errors: [] };
  }
  
  // Step 1: Check for exact matches (case-insensitive)
  const escapedBrand = normalizedBrandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  const caseInsensitiveRegex = new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapedBrand}(?![\\p{L}\\p{N}_])`,
    'gui'
  );
  
  const allMatches = output.match(caseInsensitiveRegex);
  
  if (!allMatches || allMatches.length === 0) {
    errors.push(`Brand name "${normalizedBrandName}" not found in output (Unicode-aware word boundary check)`);
    return { valid: false, errors };
  }
  
  const incorrectVariants = allMatches.filter(match => match !== normalizedBrandName);
  
  if (incorrectVariants.length > 0) {
    const uniqueIncorrect = [...new Set(incorrectVariants)];
    const variantList = uniqueIncorrect.slice(0, 3).map(v => `"${v}"`).join(", ");
    const suffix = uniqueIncorrect.length > 3 ? ` (and ${uniqueIncorrect.length - 3} more)` : "";
    errors.push(
      `Brand name has incorrect case: Found ${variantList}${suffix} but expected "${normalizedBrandName}" exactly`
    );
  }
  
  // Step 2: Fuzzy matching for misspellings (e.g., "Bocsi" vs "Bocsit", "Boscit" vs "Bocsit")
  // Uses hybrid approach to reduce false positives while catching real misspellings:
  // - Normalized distance (≤25% of brand length)
  // - First letter matching (catches "Boscit" but not "boost")
  // - Stricter length delta (≤1 char instead of ≤2)
  const wordRegex = /\b[\p{L}\p{N}_]+\b/gu;
  const allWords = output.match(wordRegex) || [];
  
  const suspiciousMisspellings: string[] = [];
  
  // Optional allowlist for common false positives (can be expanded as needed)
  const allowlist = new Set<string>([
    // Add common words that trigger false positives here if needed
    // e.g., "boost", "visit", "costs"
  ]);
  
  for (const word of allWords) {
    // Skip if it's an exact match (we already checked those)
    if (word.toLowerCase() === normalizedBrandName.toLowerCase()) {
      continue;
    }
    
    // Skip allowlisted words
    if (allowlist.has(word.toLowerCase())) {
      continue;
    }
    
    // Hybrid validation approach to reduce false positives:
    
    // 1. First letter must match (catches "Boscit" but not "boost")
    if (word[0]!.toLowerCase() !== normalizedBrandName[0]!.toLowerCase()) {
      continue;
    }
    
    // 2. Length must be very similar (within 1 character)
    const lengthDiff = Math.abs(word.length - normalizedBrandName.length);
    if (lengthDiff > 1) {
      continue;
    }
    
    // 3. Check normalized Levenshtein distance (percentage-based)
    const distance = levenshteinDistance(word, normalizedBrandName);
    const maxLength = Math.max(word.length, normalizedBrandName.length);
    const normalizedDistance = distance / maxLength;
    
    // Flag if normalized distance ≤ 25% (very similar words)
    // This threshold prioritizes avoiding false positives over catching every typo
    // Examples: "Bocsit" vs "Bocsi" = 1/6 = 16.7% ✓ (caught)
    //           "Bocsit" vs "Boxit" = 1/6 = 16.7% ✓ (caught)  
    //           "Bocsit" vs "Boscit" = 2/6 = 33.3% ✗ (not caught, but rare)
    //           "Bocsit" vs "boost" = 2/6 = 33.3% ✗ (not caught, good!)
    if (normalizedDistance > 0 && normalizedDistance <= 0.25) {
      suspiciousMisspellings.push(word);
    }
  }
  
  if (suspiciousMisspellings.length > 0) {
    const uniqueMisspellings = [...new Set(suspiciousMisspellings)];
    const misspellingList = uniqueMisspellings.slice(0, 3).map(v => `"${v}"`).join(", ");
    const suffix = uniqueMisspellings.length > 3 ? ` (and ${uniqueMisspellings.length - 3} more)` : "";
    errors.push(
      `Potential brand name misspellings detected: Found ${misspellingList}${suffix} which are similar to "${normalizedBrandName}". These may be AI-generated misspellings.`
    );
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate image prompts don't contain generic placeholders
 * Detects phrases like "company name", "company logo", "branded company", etc.
 * which indicate the actual business name wasn't interpolated into the prompt
 */
export function validateImagePromptBranding(
  imagePrompts: string[],
  businessName: string
): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!imagePrompts || imagePrompts.length === 0) {
    errors.push("No image prompts provided for validation");
    return { valid: false, errors };
  }
  
  if (!businessName || businessName.trim().length === 0) {
    errors.push("Business name is required for image prompt validation");
    return { valid: false, errors };
  }
  
  const normalizedBrandName = businessName.trim();
  
  // Generic placeholder patterns that indicate the business name wasn't interpolated
  // These patterns are specific enough to avoid false positives with legitimate brand mentions
  const placeholderPatterns = [
    /\bcompany name\b/i,                    // "company name" is always a placeholder
    /\bcompany logo\b/i,                    // "company logo" is always a placeholder
    /\bcompany's logo\b/i,                  // "company's logo" is always a placeholder
    /\bgeneric company\b/i,                 // "generic company" is obviously a placeholder
    /\bcompany brand/i,                     // "company brand" is a placeholder (e.g., "company brand colors")
    /\bthe company (?:shirt|jacket|uniform|apparel|clothing|vehicle|van|truck)\b/i,  // "the company uniform" is a placeholder
    /\bcompany[- ](?:branded|logo|uniform|shirt|jacket|vehicle|van|truck)\b/i,    // "company-branded" or "company uniform" patterns
    /\b(?:wearing|branded)\s+(?:\w+\s+){0,4}company\s+uniform/i,  // "wearing/branded ... company uniform" (max 4 words between)
  ];
  
  for (let i = 0; i < imagePrompts.length; i++) {
    const prompt = imagePrompts[i]!;
    const promptNum = i + 1;
    
    // Check for generic placeholder patterns
    for (const pattern of placeholderPatterns) {
      const match = prompt.match(pattern);
      if (match) {
        errors.push(
          `Image prompt #${promptNum} contains generic placeholder "${match[0]}" instead of actual business name "${normalizedBrandName}"`
        );
      }
    }
    
    // Ensure business name appears in the prompt
    const escapedBrand = normalizedBrandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const brandRegex = new RegExp(`\\b${escapedBrand}\\b`, 'i');
    
    if (!brandRegex.test(prompt)) {
      errors.push(
        `Image prompt #${promptNum} does not contain the business name "${normalizedBrandName}"`
      );
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
