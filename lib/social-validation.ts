import { z } from "zod";

// Platform types
export const platformSchema = z.enum(["x", "facebook", "instagram", "linkedin", "pinterest"]);
export type Platform = z.infer<typeof platformSchema>;

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
  platforms: z.array(platformSchema).min(1).max(5),
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
