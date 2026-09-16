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

/**
 * The platform contract is deliberately one typed source.  Text validation,
 * provider prompts, and image normalization must not each carry a subtly
 * different limit or geometry.
 *
 * `nativeAspectRatio` is the closest ratio accepted by Gemini.  The persisted
 * image contract is `aspectRatio` + `dimensions`, after local normalization.
 */
export interface SocialPlatformSpec {
  characterLimit: number;
  hashtagLimit: number;
  hashtagEvergreenRatio: number;
  aspectRatio: string;
  nativeAspectRatio: string;
  dimensions: Readonly<{ width: number; height: number }>;
  imageDescription: string;
}

export const PLATFORM_SPECS = {
  x: {
    characterLimit: 280,
    hashtagLimit: 3,
    hashtagEvergreenRatio: 0.67,
    aspectRatio: "16:9",
    nativeAspectRatio: "16:9",
    dimensions: { width: 1600, height: 900 },
    imageDescription: "16:9 landscape for X/Twitter",
  },
  facebook: {
    characterLimit: 63206,
    hashtagLimit: 5,
    hashtagEvergreenRatio: 0.6,
    aspectRatio: "1.91:1",
    nativeAspectRatio: "16:9",
    dimensions: { width: 1200, height: 628 },
    imageDescription: "1.91:1 landscape for Facebook",
  },
  instagram: {
    characterLimit: 2200,
    hashtagLimit: 20,
    hashtagEvergreenRatio: 0.4,
    aspectRatio: "1:1",
    nativeAspectRatio: "1:1",
    dimensions: { width: 1080, height: 1080 },
    imageDescription: "1:1 square for Instagram",
  },
  linkedin: {
    characterLimit: 3000,
    hashtagLimit: 5,
    hashtagEvergreenRatio: 0.6,
    aspectRatio: "1.91:1",
    nativeAspectRatio: "16:9",
    dimensions: { width: 1200, height: 627 },
    imageDescription: "1.91:1 landscape for LinkedIn",
  },
  pinterest: {
    characterLimit: 500,
    hashtagLimit: 10,
    hashtagEvergreenRatio: 0.5,
    aspectRatio: "2:3",
    nativeAspectRatio: "2:3",
    dimensions: { width: 1000, height: 1500 },
    imageDescription: "2:3 vertical for Pinterest",
  },
} as const satisfies Record<Platform, SocialPlatformSpec>;

// Compatibility views for callers that only need one part of the contract.
// Values are derived from PLATFORM_SPECS; do not add independent platform
// literals here.
export const PLATFORM_LIMITS = Object.fromEntries(
  Object.entries(PLATFORM_SPECS).map(([platform, spec]) => [platform, spec.characterLimit]),
) as { [P in Platform]: (typeof PLATFORM_SPECS)[P]["characterLimit"] };

export const PLATFORM_ASPECT_RATIOS = Object.fromEntries(
  Object.entries(PLATFORM_SPECS).map(([platform, spec]) => [platform, spec.aspectRatio]),
) as { [P in Platform]: (typeof PLATFORM_SPECS)[P]["aspectRatio"] };

export const PLATFORM_IMAGE_DIMENSIONS = Object.fromEntries(
  Object.entries(PLATFORM_SPECS).map(([platform, spec]) => [platform, spec.dimensions]),
) as { [P in Platform]: (typeof PLATFORM_SPECS)[P]["dimensions"] };

export type SocialImageDimensions = (typeof PLATFORM_IMAGE_DIMENSIONS)[Platform];

export function getPlatformSpec(platform: string): SocialPlatformSpec & { dimensions: SocialImageDimensions } {
  const canonical = canonicalizePlatform(platform);
  if (!canonical) throw new UnsupportedSocialPlatformError(platform);
  return PLATFORM_SPECS[canonical];
}

export function getPlatformImageDimensions(platform: string): SocialImageDimensions {
  return getPlatformSpec(platform).dimensions;
}

const SOCIAL_URL_RE = /(?:https?|ftp):\/\/[^\s<>"'`()\[\]]+|mailto:[^\s<>"'`()\[\]]+/gi;
const URL_TRAILING_PUNCTUATION_RE = /[.,!?;:]+$/;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

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
  const candidates = [
    ...(text.match(SOCIAL_URL_RE) ?? []),
    ...Array.from(text.matchAll(MARKDOWN_LINK_RE), (match) => match[2]!.trim()),
  ];
  return [...new Set(candidates.map(cleanUrlCandidate).filter((candidate) => !isValidSocialUrl(candidate)))];
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
 *
 * This is a validator, not a repairer.  In particular it must never remove a
 * sentence, rewrite a claim, strip a URL, or truncate an over-limit caption.
 * The exact provider output is returned even on failure so callers cannot
 * accidentally persist a repaired/paid retry artifact.
 */
export function enforceSocialCaptionCompliance(
  caption: string,
  platform: string,
  sourceText?: string
): SocialCaptionCompliance {
  const canonical = canonicalizePlatform(platform);
  if (!canonical) throw new UnsupportedSocialPlatformError(platform);
  const limit = getPlatformSpec(canonical).characterLimit;
  const unsupported = findUnsupportedSocialClaims(caption, sourceText);

  const issues: string[] = [];
  if (!caption.trim()) issues.push("caption is empty");
  if (caption.length > limit) {
    issues.push(`caption exceeds ${canonical} limit of ${limit} characters`);
  }
  const invalidUrls = findInvalidSocialUrls(caption);
  if (invalidUrls.length > 0) {
    issues.push(`caption contains invalid URL(s): ${invalidUrls.join(", ")}`);
  }
  if (unsupported.length > 0) {
    issues.push("caption contains unsupported numeric savings/efficiency claim(s)");
  }

  return { caption, valid: issues.length === 0, issues };
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
  const limit = getPlatformSpec(canonical).characterLimit;
  const selectedHashtags: T[] = [];
  let characterCountWithHashtags = compliance.caption.length;

  for (const hashtag of hashtags) {
    const tag = hashtag.tag;
    if (!tag.trim()) continue;
    const nextCount = characterCountWithHashtags + 1 + tag.length;
    // Only drop a deterministic trailing suffix.  Do not skip an over-limit
    // hashtag and then retain a later one, which would reorder/repair output.
    if (nextCount > limit) break;
    selectedHashtags.push(hashtag);
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
