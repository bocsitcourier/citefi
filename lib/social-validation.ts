import { z } from "zod";

// Platform types
export const platformSchema = z.enum(["x", "facebook", "instagram", "linkedin", "pinterest"]);
export type Platform = z.infer<typeof platformSchema>;

/**
 * API-facing platform aliases.  The database, queue and provider boundary use
 * only the canonical keys below.  In particular, the UI's historical
 * "twitter" key is accepted as an alias for X, but it must never reach a
 * provider or be persisted as a second platform.
 */
const PLATFORM_ALIASES: Record<string, Platform> = {
  x: "x",
  twitter: "x",
  "x/twitter": "x",
  "twitter/x": "x",
  "twitter-x": "x",
  "x-twitter": "x",
  twitterx: "x",
  "twitter (x)": "x",
  facebook: "facebook",
  fb: "facebook",
  instagram: "instagram",
  ig: "instagram",
  linkedin: "linkedin",
  pinterest: "pinterest",
  pin: "pinterest",
};

export class UnsupportedSocialPlatformError extends Error {
  readonly code = "UNSUPPORTED_SOCIAL_PLATFORM";
  readonly platform: string;

  constructor(platform: unknown) {
    const value = typeof platform === "string" ? platform : String(platform);
    super(
      `Unsupported social platform "${value}". Supported platforms: x, facebook, instagram, linkedin, pinterest`
    );
    this.name = "UnsupportedSocialPlatformError";
    this.platform = value;
  }
}

/** Return a canonical platform key, or null for an unknown value. */
export function canonicalizePlatform(platform: unknown): Platform | null {
  if (typeof platform !== "string") return null;
  return PLATFORM_ALIASES[platform.toLowerCase().trim()] ?? null;
}

/**
 * Normalize aliases and remove duplicates before a social job is created.
 * Unknown values are rejected rather than silently falling back to X.
 */
export function canonicalizePlatforms(platforms: readonly unknown[]): Platform[] {
  const canonical: Platform[] = [];
  for (const platform of platforms) {
    const key = canonicalizePlatform(platform);
    if (!key) throw new UnsupportedSocialPlatformError(platform);
    if (!canonical.includes(key)) canonical.push(key);
  }
  if (canonical.length === 0) {
    throw new Error("At least one supported social platform is required");
  }
  if (canonical.length > 5) {
    throw new Error("A social post can target at most five unique platforms");
  }
  return canonical;
}

// Tone and mood options
export const toneSchema = z.enum([
  "professional",
  "friendly",
  "witty",
  "bold",
  "inspiring",
  "casual",
  "formal",
  "humorous",
]);

export const moodSchema = z.enum([
  "energetic",
  "calm",
  "humorous",
  "informative",
  "motivational",
  "thoughtful",
  "urgent",
]);

// Industry categories
export const industrySchema = z.enum([
  "technology",
  "healthcare",
  "finance",
  "marketing",
  "education",
  "retail",
  "real_estate",
  "hospitality",
  "logistics",
  "manufacturing",
  "legal",
  "consulting",
  "entertainment",
  "non_profit",
  "other",
]);

// Social post generation request schema
export const socialPostGenerateRequestSchema = z.object({
  userId: z.number().int().positive(),
  prompt: z.string().min(10).max(1000),
  // Aliases are accepted at the API boundary and canonicalized before queueing.
  platforms: z.array(z.string().min(1)).min(1).max(5).superRefine((values, context) => {
    values.forEach((value, index) => {
      if (!canonicalizePlatform(value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Unsupported social platform "${value}"`,
        });
      }
    });
  }),
  tone: toneSchema.optional(),
  mood: moodSchema.optional(),
  industry: industrySchema.optional(),
  includeImage: z.boolean().default(true),
  userEmail: z.string().email().optional(),
  articleId: z.number().int().positive().optional(), // Optional link to article
});

export type SocialPostGenerateRequest = z.infer<typeof socialPostGenerateRequestSchema>;

// Social post update request schema
export const socialPostUpdateRequestSchema = z.object({
  userId: z.number().int().positive(),
  status: z.enum(["PENDING", "GENERATING", "READY", "SCHEDULED", "POSTED", "FAILED"]).optional(),
  scheduleAt: z.string().datetime().optional(), // ISO datetime string
});

export type SocialPostUpdateRequest = z.infer<typeof socialPostUpdateRequestSchema>;

// Platform-specific character limits
export const PLATFORM_LIMITS = {
  x: 280,
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  pinterest: 500,
} as const;

// Platform-specific aspect ratios
export const PLATFORM_ASPECT_RATIOS = {
  x: "16:9",
  facebook: "1.91:1",
  instagram: "1:1",
  linkedin: "1.91:1",
  pinterest: "2:3",
} as const;

/**
 * Canonical output dimensions.  Gemini's image API may return a different
 * native size (and does not support 1.91:1), so the image worker always
 * post-processes to these exact dimensions before storing the bytes.
 */
export const PLATFORM_IMAGE_DIMENSIONS = {
  x: { width: 1600, height: 900 },
  facebook: { width: 1200, height: 628 },
  instagram: { width: 1080, height: 1080 },
  linkedin: { width: 1200, height: 627 },
  pinterest: { width: 1000, height: 1500 },
} as const;

export type SocialImageDimensions = (typeof PLATFORM_IMAGE_DIMENSIONS)[Platform];

export function getPlatformImageDimensions(platform: string): SocialImageDimensions {
  const canonical = canonicalizePlatform(platform);
  if (!canonical) throw new UnsupportedSocialPlatformError(platform);
  return PLATFORM_IMAGE_DIMENSIONS[canonical];
}

const SOCIAL_URL_RE = /(?:https?:\/\/|mailto:)[^\s<>"'`()\[\]]+/gi;
const URL_TRAILING_PUNCTUATION_RE = /[.,!?;:]+$/;

function cleanUrlCandidate(value: string): string {
  return value.replace(URL_TRAILING_PUNCTUATION_RE, "");
}

export function isValidSocialUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  const candidate = cleanUrlCandidate(value.trim());
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.hostname.length > 0 && !/\s/.test(candidate);
    }
    if (parsed.protocol === "mailto:") {
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(parsed.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

/** Return URL-like tokens that are malformed or use an unsupported scheme. */
export function findInvalidSocialUrls(text: string): string[] {
  return (text.match(SOCIAL_URL_RE) ?? [])
    .map(cleanUrlCandidate)
    .filter((candidate) => !isValidSocialUrl(candidate));
}

function plainSocialText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * A conservative guard for numeric savings/efficiency claims.  Claims are
 * allowed only when the complete sentence is present in the source brief.
 * This prevents a post-rewrite model from reintroducing an unsupported claim
 * such as "30% of heating escapes" after an earlier critic pass removed it.
 */
export function findUnsupportedSocialClaims(
  caption: string,
  sourceText?: string
): string[] {
  const source = plainSocialText(sourceText ?? "");
  const sentences = caption
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.filter((sentence) => {
    const hasNumericClaim = /\b\d+(?:\.\d+)?\s*(?:%|percent)(?!\w)/i.test(sentence);
    const hasSavingsLanguage =
      /\b(?:save|saves|saving|savings|reduce|reduction|decrease|decreases|escape|escapes|leak|leaks|efficien(?:t|cy)|utility|cost|costs)\b/i.test(
        sentence
      );
    if (!hasNumericClaim || !hasSavingsLanguage) return false;
    return source.length === 0 || !source.includes(plainSocialText(sentence));
  });
}

function removeBrokenSocialUrls(caption: string): string {
  // Preserve readable link text for Markdown links while removing malformed
  // destinations.  Raw malformed URL tokens are removed entirely.
  const withoutBrokenMarkdownLinks = caption.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (full, label: string, destination: string) =>
      isValidSocialUrl(destination) ? full : label
  );
  return withoutBrokenMarkdownLinks.replace(SOCIAL_URL_RE, (candidate) =>
    isValidSocialUrl(candidate) ? candidate : ""
  ).replace(/\s{2,}/g, " ").trim();
}

function removeUnsupportedSocialClaims(caption: string, unsupported: string[]): string {
  if (unsupported.length === 0) return caption;
  const unsupportedSet = new Set(unsupported);
  return caption
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => !unsupportedSet.has(sentence.trim()))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Truncate without splitting a URL token.  A URL that would not fit is
 * omitted rather than sliced into a broken destination.
 */
export function truncateSocialCaption(caption: string, characterLimit: number): string {
  if (caption.length <= characterLimit) return caption.trim();
  const output: string[] = [];
  let length = 0;
  for (const token of caption.trim().split(/\s+/)) {
    const separator = output.length > 0 ? 1 : 0;
    const nextLength = length + separator + token.length;
    if (nextLength <= characterLimit) {
      output.push(token);
      length = nextLength;
      continue;
    }
    // Never keep a partial URL.  For ordinary prose, stopping at the previous
    // complete word is preferable to producing a malformed final sentence.
    break;
  }
  return output.join(" ").trim();
}

export interface SocialCaptionCompliance {
  caption: string;
  valid: boolean;
  issues: string[];
}

export interface SocialCaptionWithHashtags<T extends { tag: string }> extends SocialCaptionCompliance {
  hashtags: T[];
  characterCountWithHashtags: number;
}

/**
 * Final, deterministic compliance pass.  This intentionally runs after every
 * provider/critic rewrite and is the last gate before a READY variant is
 * persisted.
 */
export function enforceSocialCaptionCompliance(
  caption: string,
  platform: string,
  sourceText?: string
): SocialCaptionCompliance {
  const canonical = canonicalizePlatform(platform);
  if (!canonical) throw new UnsupportedSocialPlatformError(platform);
  const limit = PLATFORM_LIMITS[canonical];
  const unsupported = findUnsupportedSocialClaims(caption, sourceText);
  let finalCaption = removeUnsupportedSocialClaims(caption, unsupported);
  finalCaption = removeBrokenSocialUrls(finalCaption);
  finalCaption = truncateSocialCaption(finalCaption, limit);

  const issues: string[] = [];
  if (!finalCaption) issues.push("caption is empty after final compliance");
  if (finalCaption.length > limit) {
    issues.push(`caption exceeds ${canonical} limit of ${limit} characters`);
  }
  const invalidUrls = findInvalidSocialUrls(finalCaption);
  if (invalidUrls.length > 0) {
    issues.push(`caption contains invalid URL(s): ${invalidUrls.join(", ")}`);
  }
  // A claim that survived the rewrite/sanitization is a hard failure.
  const remainingUnsupported = findUnsupportedSocialClaims(finalCaption, sourceText);
  if (remainingUnsupported.length > 0) {
    issues.push("caption contains unsupported numeric savings/efficiency claim(s)");
  }

  return { caption: finalCaption, valid: issues.length === 0, issues };
}

/**
 * The dashboard renders hashtags after the caption. Fit both pieces together
 * before persistence so a caption that is valid by itself cannot exceed the
 * platform limit once the UI appends its hashtag string.
 */
export function enforceSocialCaptionWithHashtags<T extends { tag: string }>(
  caption: string,
  hashtags: readonly T[],
  platform: string,
  sourceText?: string
): SocialCaptionWithHashtags<T> {
  const compliance = enforceSocialCaptionCompliance(caption, platform, sourceText);
  if (!compliance.valid) {
    return {
      ...compliance,
      hashtags: [],
      characterCountWithHashtags: compliance.caption.length,
    };
  }

  const canonical = canonicalizePlatform(platform);
  if (!canonical) throw new UnsupportedSocialPlatformError(platform);
  const limit = PLATFORM_LIMITS[canonical];
  const selectedHashtags: T[] = [];
  let characterCountWithHashtags = compliance.caption.length;

  for (const hashtag of hashtags) {
    const tag = hashtag.tag.trim();
    if (!tag) continue;
    const nextCount = characterCountWithHashtags + 1 + tag.length;
    if (nextCount > limit) continue;
    selectedHashtags.push({ ...hashtag, tag } as T);
    characterCountWithHashtags = nextCount;
  }

  return {
    ...compliance,
    hashtags: selectedHashtags,
    characterCountWithHashtags,
  };
}

// Hashtag with mailto link schema
export const hashtagSchema = z.object({
  tag: z.string(), // e.g., "#Innovation"
  mailtoLink: z.string().url(), // e.g., "mailto:user@email.com?subject=Innovation%20Inquiry"
});

// Social post variant schema (for response)
export const socialPostVariantResponseSchema = z.object({
  id: z.number(),
  platform: platformSchema,
  caption: z.string(),
  characterCount: z.number(),
  hashtags: z.array(hashtagSchema),
  emojis: z.array(z.string()).optional(),
  hyperlinks: z.array(z.object({
    text: z.string(),
    url: z.string().url(),
  })).optional(),
});

// Social post response schema
export const socialPostResponseSchema = z.object({
  id: z.number(),
  userId: z.number(),
  prompt: z.string(),
  tone: toneSchema.nullable(),
  mood: moodSchema.nullable(),
  industry: industrySchema.nullable(),
  platforms: z.array(platformSchema),
  status: z.string(),
  includeImage: z.boolean(),
  scheduleAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  variants: z.array(socialPostVariantResponseSchema).optional(),
  assets: z.array(z.object({
    id: z.number(),
    platform: platformSchema,
    storageUrl: z.string(),
    altText: z.string().nullable(),
    aspectRatio: z.string(),
  })).optional(),
});

export type SocialPostResponse = z.infer<typeof socialPostResponseSchema>;
