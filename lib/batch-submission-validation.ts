import { z } from "zod";

export const batchSubmitSchema = z.object({
  batchId: z.number().int().positive(),
  selectedTitles: z.array(z.string().trim().min(1).max(255)).min(1).max(100)
    .transform((titles) => [...new Set(titles)]),
  targetUrl: z.string().url(),
  tone: z.string().optional(),
  wordCountMin: z.number().min(500).max(5000).default(800),
  wordCountMax: z.number().min(500).max(5000).default(2000),
  geographicFocus: z.string().optional(),
  audience: z.string().optional(),
  businessName: z.string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, "Business name is required to ensure brand consistency")),
  businessAddress: z.string().optional(),
  businessPhone: z.string().optional(),
  companyLogoUrl: z.string()
    .optional()
    .transform((value) => value === "" ? undefined : value)
    .refine(
      (value) => !value || value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://"),
      { message: "Must be a valid URL or relative path" },
    )
    .optional(),
  competitorUrls: z.array(z.string().url()).max(5).optional(),
  semanticClusterId: z.number().optional(),
  serpFeatureTarget: z.enum(["Featured Snippet", "PAA", "List", "Q&A"]).optional(),
  autoPublishEnabled: z.boolean().optional().default(false),
  autoPublishConnectionIds: z.array(z.number()).optional(),
  personaId: z.number().optional(),
}).refine((data) => data.wordCountMin <= data.wordCountMax, {
  message: "Minimum word count must be less than or equal to maximum word count",
  path: ["wordCountMin"],
});