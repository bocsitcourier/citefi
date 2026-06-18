import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, serial, jsonb, index, uniqueIndex, uuid, boolean, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// TEAM MANAGEMENT TABLES - Must be defined FIRST for foreign key references
// ============================================================================

// Teams table - organizational units for user isolation
export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  createdBy: integer("created_by").notNull().references((): AnyPgColumn => users.id), // Circular reference handled by Drizzle
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Stripe billing
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }).unique(),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }).unique(),
  billingPlan: varchar("billing_plan", { length: 30 }).notNull().default("free"),
  billingStatus: varchar("billing_status", { length: 30 }).notNull().default("active"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  // Agency hierarchy — a client team points to its parent agency team
  parentTeamId: integer("parent_team_id").references((): AnyPgColumn => teams.id, { onDelete: "set null" }),
  clientStatus: varchar("client_status", { length: 20 }).notNull().default("active"), // active, archived
}, (table) => ({
  publicIdIdx: index("teams_public_id_idx").on(table.publicId),
  nameIdx: index("teams_name_idx").on(table.name),
  createdByIdx: index("teams_created_by_idx").on(table.createdBy),
  stripeCustomerIdx: index("teams_stripe_customer_idx").on(table.stripeCustomerId),
  parentTeamIdx: index("teams_parent_team_idx").on(table.parentTeamId),
  parentClientStatusIdx: index("teams_parent_client_status_idx").on(table.parentTeamId, table.clientStatus),
}));

// Team Members table - join table for user-team relationships
export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }), // Circular reference handled by Drizzle
  role: varchar("role", { length: 50 }).notNull().default("member"), // member, admin
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, (table) => ({
  teamUserUnique: uniqueIndex("team_members_team_user_unique").on(table.teamId, table.userId),
  teamIdIdx: index("team_members_team_id_idx").on(table.teamId),
  userIdIdx: index("team_members_user_id_idx").on(table.userId),
}));

// ============================================================================
// MVP CORE TABLES - Essential for basic content generation pipeline
// ============================================================================

// Users table - authentication and roles with comprehensive security
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash"), // Bcrypt hashed password (nullable for OAuth-only users)
  role: varchar("role", { length: 50 }).notNull().default("team_member"), // team_member, admin
  
  // Account Status & Security
  accountStatus: varchar("account_status", { length: 20 }).notNull().default("active"), // active, locked, suspended
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  
  // 2FA Configuration
  twoFactorEnabled: integer("two_factor_enabled").notNull().default(0), // Boolean as 0/1
  twoFactorMethod: varchar("two_factor_method", { length: 20 }), // email, totp (Google Authenticator)
  emailVerified: integer("email_verified").notNull().default(0), // Boolean as 0/1
  
  // OAuth Integration
  googleId: varchar("google_id", { length: 255 }).unique(), // Google OAuth user ID
  
  // Profile Information
  fullName: varchar("full_name", { length: 255 }),
  profilePictureUrl: text("profile_picture_url"),
  
  // Team Management
  defaultTeamId: integer("default_team_id").references((): AnyPgColumn => teams.id),
  
  // Soft Delete Support
  deletedAt: timestamp("deleted_at"),
  
  // Timestamps
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  emailIdx: index("users_email_idx").on(table.email),
  googleIdIdx: index("users_google_id_idx").on(table.googleId),
  roleIdx: index("users_role_idx").on(table.role),
  publicIdIdx: index("users_public_id_idx").on(table.publicId),
  defaultTeamIdIdx: index("users_default_team_id_idx").on(table.defaultTeamId),
}));

// Sessions table - tracks active JWT sessions for monitoring and force logout
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 hash of JWT for revocation
  ipAddress: varchar("ip_address", { length: 255 }), // IPv4/IPv6 or forwarded chain
  userAgent: text("user_agent"), // Browser/device info
  deviceInfo: jsonb("device_info"), // Parsed user agent details
  
  // Session Management
  isActive: integer("is_active").notNull().default(1), // Boolean as 0/1
  expiresAt: timestamp("expires_at").notNull(),
  lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
  
  // Team Context (for team-scoped sessions)
  teamContextId: integer("team_context_id").references(() => teams.id),
  
  // Force Logout Support
  forceLogoutAt: timestamp("force_logout_at"), // When session was forcefully terminated
  terminatedBy: integer("terminated_by").references(() => users.id), // Admin who terminated session
  terminationReason: varchar("termination_reason", { length: 255 }), // Reason for termination
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("sessions_user_id_idx").on(table.userId),
  tokenHashIdx: index("sessions_token_hash_idx").on(table.tokenHash),
  expiresAtIdx: index("sessions_expires_at_idx").on(table.expiresAt),
  isActiveIdx: index("sessions_is_active_idx").on(table.isActive),
  forceLogoutAtIdx: index("sessions_force_logout_at_idx").on(table.forceLogoutAt),
}));

// Activity Logs table - comprehensive audit trail for admin monitoring
export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id), // Nullable for system events
  teamId: integer("team_id").references(() => teams.id), // Track team context
  
  // Event Details
  action: varchar("action", { length: 100 }).notNull(), // login, logout, password_change, 2fa_setup, content_generate, etc.
  resource: varchar("resource", { length: 100 }), // users, articles, social_posts, etc.
  resourceId: integer("resource_id"), // ID of affected resource
  
  // Enhanced Tracking (for team-scoped content)
  targetType: varchar("target_type", { length: 50 }), // article, video, social, batch, system
  targetPublicId: varchar("target_public_id", { length: 36 }), // UUID of target resource
  
  // Context Information
  ipAddress: varchar("ip_address", { length: 255 }),
  userAgent: text("user_agent"),
  details: jsonb("details"), // Additional context (old values, new values, error messages)
  
  // Severity for filtering
  severity: varchar("severity", { length: 20 }).notNull().default("info"), // info, warning, error, critical
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("activity_logs_user_id_idx").on(table.userId),
  teamIdActionIdx: index("activity_logs_team_id_action_idx").on(table.teamId, table.action),
  actionIdx: index("activity_logs_action_idx").on(table.action),
  createdAtIdx: index("activity_logs_created_at_idx").on(table.createdAt),
  severityIdx: index("activity_logs_severity_idx").on(table.severity),
  targetPublicIdIdx: index("activity_logs_target_public_id_idx").on(table.targetPublicId),
}));

// TOTP Secrets table - stores Google Authenticator secrets
export const totpSecrets = pgTable("totp_secrets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  secret: varchar("secret", { length: 64 }).notNull(), // Base32-encoded TOTP secret
  backupCodes: jsonb("backup_codes"), // Array of one-time backup codes (hashed)
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
}, (table) => ({
  userIdIdx: index("totp_secrets_user_id_idx").on(table.userId),
}));

// Email Verification Codes table - stores temporary 2FA codes sent via email
export const emailVerificationCodes = pgTable("email_verification_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  code: varchar("code", { length: 6 }).notNull(), // 6-digit code
  purpose: varchar("purpose", { length: 50 }).notNull(), // login_2fa, email_verification, password_reset
  
  // Security
  attempts: integer("attempts").notNull().default(0), // Track verification attempts
  isUsed: integer("is_used").notNull().default(0), // Boolean as 0/1
  expiresAt: timestamp("expires_at").notNull(),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("email_codes_user_id_idx").on(table.userId),
  codeIdx: index("email_codes_code_idx").on(table.code),
  expiresAtIdx: index("email_codes_expires_at_idx").on(table.expiresAt),
}));

// Job Batches table - tracks bulk submission jobs
export const jobBatches = pgTable("job_batches", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  userId: integer("user_id").notNull().references(() => users.id),
  teamId: integer("team_id").references(() => teams.id),
  localeId: integer("locale_id").references(() => locales.id), // Geographic location reference
  coreTopic: text("core_topic").notNull(), // Changed from varchar(255) to text to support longer topics
  targetUrl: text("target_url").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("PENDING"), // PENDING, RUNNING, PARTIAL_COMPLETE, COMPLETE, FAILED
  numArticlesRequested: integer("num_articles_requested").notNull(),
  titlePoolJson: jsonb("title_pool_json"), // Stores array of 50 titles
  generationParams: jsonb("generation_params"), // Stores tone, wordCountMin, wordCountMax, geographicFocus, audience
  
  // NAP Data (Name, Address, Phone) for Local SEO
  businessName: varchar("business_name", { length: 255 }), // Business/brand name
  businessAddress: text("business_address"), // Full street address
  businessPhone: varchar("business_phone", { length: 20 }), // E.164 format (+1-415-555-0123)
  
  // Company Branding (for image generation)
  companyLogoUrl: text("company_logo_url"), // Logo uploaded to object storage for AI image reference
  
  // Advanced Features
  competitorUrlsJson: jsonb("competitor_urls_json"), // Array of 1-5 competitor URLs for grounding
  semanticClusterId: integer("semantic_cluster_id"), // Optional linking cluster ID
  serpFeatureTarget: varchar("serp_feature_target", { length: 50 }), // Featured Snippet, PAA, List, Q&A
  
  // Auto-Publishing Configuration
  autoPublishEnabled: integer("auto_publish_enabled").notNull().default(0), // Boolean as 0/1
  autoPublishConnectionIds: jsonb("auto_publish_connection_ids"), // Array of publishing connection IDs to auto-publish to
  
  // Psychographic Targeting
  personaId: integer("persona_id"), // Optional audience persona for content adaptation
  
  // Soft Delete Support
  deletedAt: timestamp("deleted_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  publicIdIdx: index("job_batches_public_id_idx").on(table.publicId),
  teamIdStatusIdx: index("job_batches_team_id_status_idx").on(table.teamId, table.status),
  userIdIdx: index("job_batches_user_id_idx").on(table.userId),
}));

// Articles table - stores final content with all SEO metadata
export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  batchId: integer("batch_id").notNull().references(() => jobBatches.id),
  teamId: integer("team_id").references(() => teams.id),
  localeId: integer("locale_id").references(() => locales.id), // Geographic location reference
  articleStatus: varchar("article_status", { length: 50 }).notNull().default("PENDING"), // PENDING, IN_PROGRESS, GEMINI_COMPLETE, CHATGPT_REVIEWED, GPT4_ENHANCED, COMPLETE, FAILED
  chosenTitle: varchar("chosen_title", { length: 255 }).notNull(),
  finalHtmlContent: text("final_html_content"),
  heroImageUrl: text("hero_image_url"), // Primary hero image URL for article display
  seoTitle: varchar("seo_title", { length: 60 }),
  metaDescription: varchar("meta_description", { length: 160 }),
  slug: varchar("slug", { length: 255 }).unique(),
  keywordsJson: jsonb("keywords_json"), // Array of long-phrase keywords
  hashtagsJson: jsonb("hashtags_json"), // Array of hashtags
  faqJson: jsonb("faq_json"), // Array of {question, answer} FAQ items
  imagePromptsJson: jsonb("image_prompts_json"), // Array of 3 DALL-E image generation prompts from Gemini
  wordCount: integer("word_count"),
  
  // Advanced SEO & Geo Features
  geoAccuracyScore: integer("geo_accuracy_score"), // 0-100 score for local relevance
  internalLinkSuggestions: jsonb("internal_link_suggestions"), // Suggested anchors for cluster linking
  
  // ChatGPT Review Layer Enrichment
  seoScore: integer("seo_score"), // 0-100 ChatGPT SEO quality score
  hyperlinkedKeywordsJson: jsonb("hyperlinked_keywords_json"), // 5-10 internal/external keyword links
  metaEnrichment: jsonb("meta_enrichment"), // ChatGPT social snippets, OG tags, schema markup
  
  // AI Podcast Module
  podcastUrl: text("podcast_url"), // Storage URL for generated podcast audio
  podcastDuration: integer("podcast_duration"), // Duration in seconds
  podcastGeneratedAt: timestamp("podcast_generated_at"),
  podcastStatus: varchar("podcast_status", { length: 50 }).default("none"), // none, pending, processing, ready, failed
  podcastScriptJson: jsonb("podcast_script_json"), // Two-voice conversational script

  // Failure tracking — stores the human-readable reason an article reached FAILED status
  errorMessage: text("error_message"),

  // Soft Delete Support
  deletedAt: timestamp("deleted_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("articles_public_id_idx").on(table.publicId),
  teamIdStatusIdx: index("articles_team_id_status_idx").on(table.teamId, table.articleStatus),
  batchIdIdx: index("articles_batch_id_idx").on(table.batchId),
  slugIdx: index("articles_slug_idx").on(table.slug),
}));

// Article Assets table - stores image/audio/video metadata
export const articleAssets = pgTable("article_assets", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  articleId: integer("article_id").notNull().references(() => articles.id),
  teamId: integer("team_id").references(() => teams.id),
  assetType: varchar("asset_type", { length: 20 }).notNull().default("image"), // image, audio, video
  imagePromptUsed: text("image_prompt_used"),
  storageUrl: text("storage_url").notNull(),
  altText: varchar("alt_text", { length: 255 }),
  fileFormat: varchar("file_format", { length: 10 }).notNull().default("webp"),
  metadataJson: jsonb("metadata_json"), // video duration, dimensions, audio bitrate
  
  // Soft Delete Support
  deletedAt: timestamp("deleted_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("article_assets_public_id_idx").on(table.publicId),
  teamIdIdx: index("article_assets_team_id_idx").on(table.teamId),
  articleIdIdx: index("article_assets_article_id_idx").on(table.articleId),
}));

// Job Events table - tracks all job processing events for debugging
export const jobEvents = pgTable("job_events", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").references(() => jobBatches.id),
  articleId: integer("article_id").references(() => articles.id),
  eventType: varchar("event_type", { length: 50 }).notNull(), // TITLE_POOL_START, TITLE_POOL_COMPLETE, ARTICLE_START, STAGE_1, STAGE_2, STAGE_3, ARTICLE_COMPLETE, ARTICLE_FAILED
  stage: varchar("stage", { length: 50 }), // GEMINI, GPT, IMAGES
  message: text("message").notNull(),
  payloadJson: jsonb("payload_json"), // Additional event data (word count, errors, etc)
  durationMs: integer("duration_ms"), // Time taken for this event
  severity: varchar("severity", { length: 20 }).notNull().default("info"), // info, warning, error
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  batchIdIdx: index("job_events_batch_id_idx").on(table.batchId),
  articleIdIdx: index("job_events_article_id_idx").on(table.articleId),
  createdAtIdx: index("job_events_created_at_idx").on(table.createdAt),
  eventTypeIdx: index("job_events_event_type_idx").on(table.eventType),
  severityIdx: index("job_events_severity_idx").on(table.severity),
}));

// ============================================================================
// OPTIONAL GEO TABLE - Can be added later but keeping schema for compatibility
// ============================================================================

// Article Runs table - tracks regeneration attempts with cached outputs
export const articleRuns = pgTable("article_runs", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").notNull().references(() => articles.id),
  runId: varchar("run_id", { length: 36 }).notNull(), // UUID v4
  runType: varchar("run_type", { length: 50 }).notNull().default("generation"), // generation, regeneration, manual
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  status: varchar("status", { length: 20 }).notNull().default("running"), // running, completed, failed
  cachedGeminiOutput: jsonb("cached_gemini_output"), // Stage 1 output
  cachedChatgptOutput: jsonb("cached_chatgpt_output"), // Stage 2 output  
  cachedGpt4Output: jsonb("cached_gpt4_output"), // Stage 3 output
}, (table) => ({
  // CRITICAL: Unique constraint prevents duplicate runs and enables cache lookup
  articleRunsUnique: uniqueIndex("article_runs_article_id_run_id_unique").on(table.articleId, table.runId),
  articleIdIdx: index("article_runs_article_id_idx").on(table.articleId),
  runIdIdx: index("article_runs_run_id_idx").on(table.runId),
  statusIdx: index("article_runs_status_idx").on(table.status),
}));

// Locales table - geographic locations with coordinates for geo-first features
export const locales = pgTable("locales", {
  id: serial("id").primaryKey(),
  countryCode: varchar("country_code", { length: 2 }).notNull(), // US, CA, UK (ISO 3166-1 alpha-2)
  region: varchar("region", { length: 100 }), // State/Province
  city: varchar("city", { length: 100 }),
  postalCode: varchar("postal_code", { length: 20 }),
  
  // Geocoding coordinates (6 decimal precision ~0.11 meters)
  latitude: varchar("latitude", { length: 20 }), // Decimal degrees format: 37.774929
  longitude: varchar("longitude", { length: 20 }), // Decimal degrees format: -122.419418
  
  // Google Places API metadata
  placeId: varchar("place_id", { length: 255 }).unique(), // Google Places unique ID
  formattedAddress: text("formatted_address"), // Full address from Google
  
  // Additional locale metadata
  language: varchar("language", { length: 10 }).notNull().default("en-US"),
  timezone: varchar("timezone", { length: 50 }), // IANA timezone (e.g., America/Los_Angeles)
  population: integer("population"), // Optional demographic data
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  cityRegionIdx: index("locales_city_region_idx").on(table.city, table.region),
  placeIdIdx: index("locales_place_id_idx").on(table.placeId),
  coordinatesIdx: index("locales_coordinates_idx").on(table.latitude, table.longitude),
}));

// ============================================================================
// BATCH-LEVEL SEO CACHE - Performance Optimization
// Stores reusable SEO context once per batch (30-50% API call reduction)
// ============================================================================

// Batch SEO Cache table - stores reusable analysis per batch
export const batchSeoCache = pgTable("batch_seo_cache", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => jobBatches.id).unique(),
  
  // Location Analysis (generated once, reused across all articles)
  locationAnalysisJson: jsonb("location_analysis_json"), // Demographics, landmarks, local culture
  locationKeywordsJson: jsonb("location_keywords_json"), // City-specific keyword variations
  
  // Competitor Research (generated once per batch)
  competitorInsightsJson: jsonb("competitor_insights_json"), // Analyzed competitor patterns
  competitorKeywordsJson: jsonb("competitor_keywords_json"), // Extracted keyword opportunities
  
  // Semantic Clusters (shared topic groupings)
  semanticClustersJson: jsonb("semantic_clusters_json"), // Related topic clusters
  topicalAuthorityJson: jsonb("topical_authority_json"), // Subject matter expertise context
  
  // ENHANCED v2.0: Deep Local Intelligence
  localRegulations: jsonb("local_regulations"), // Local laws, licensing, zoning regulations
  authorityEntities: jsonb("authority_entities"), // Local organizations, experts, landmarks with credibility scores
  keyStatistics: jsonb("key_statistics"), // Statistics with sources and freshness dates
  
  // ENHANCED v3.0: Intent-Based Content Gap Analysis (Reddit Research)
  redditResearch: jsonb("reddit_research"), // Reddit questions, discussions, content gaps, E-E-A-T proof
  
  // ENHANCED v3.1: Expert Discovery for E-E-A-T signals
  expertDiscovery: jsonb("expert_discovery"), // Subject matter experts with credibility scores
  
  // Session Metadata
  cacheVersion: varchar("cache_version", { length: 10 }).notNull().default("3.1"), // Cache schema version (v3.1: Reddit JSON API + Expert Discovery)
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"), // Optional TTL for cache invalidation
}, (table) => ({
  batchIdIdx: index("batch_seo_cache_batch_id_idx").on(table.batchId),
}));

// ============================================================================
// ADVANCED FEATURE TABLES - SEO Logs, Social Posts, Error Tracking, Versioning
// ============================================================================

// SEO Logs table - tracks SEO performance and costs
export const seoLogs = pgTable("seo_logs", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").notNull().references(() => articles.id),
  tokenCost: integer("token_cost").notNull(), // AI tokens consumed
  geoAccuracyScore: integer("geo_accuracy_score"), // 0-100 score
  schemaValidationFail: integer("schema_validation_fail").notNull().default(0), // Boolean as 0/1
  rankTrackingScore: integer("rank_tracking_score"), // Optional rank improvement metric
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  articleIdIdx: index("seo_logs_article_id_idx").on(table.articleId),
}));

// ============================================================================
// STANDALONE SOCIAL MEDIA MODULE - Phase 10
// Separate from article generation pipeline
// ============================================================================

// Social Posts table - standalone social media post generator (Enhanced for Business)
export const socialPosts = pgTable("social_posts", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  userId: integer("user_id").notNull().references(() => users.id),
  teamId: integer("team_id").references(() => teams.id),
  articleId: integer("article_id").references(() => articles.id), // Optional linking to articles
  
  // Business-Focused User Input
  topic: varchar("topic", { length: 255 }).notNull(), // Main topic of the post
  title: varchar("title", { length: 255 }).notNull(), // Post headline
  location: varchar("location", { length: 255 }).notNull(), // City, neighborhood, landmark for geo-targeting
  prompt: text("prompt"), // Additional content prompt (now optional)
  tone: varchar("tone", { length: 50 }).notNull().default("Professional"), // Professional, Authoritative, Friendly-Professional, Insightful, Executive
  mood: varchar("mood", { length: 50 }), // Motivational, Analytical, Informative, Persuasive, Neutral
  industry: varchar("industry", { length: 100 }), // Logistics, Finance, Healthcare, Retail, Tech, etc.
  landingPageUrl: varchar("landing_page_url", { length: 500 }), // URL for internal hyperlinks in posts
  
  // Company Branding (for video generation)
  companyName: varchar("company_name", { length: 255 }), // Company name to display in video
  companyLogoUrl: text("company_logo_url"), // Logo uploaded to object storage
  
  // Selected Platforms (JSON array: ["x", "facebook", "instagram", "linkedin", "pinterest"])
  platformsJson: jsonb("platforms_json").notNull(),
  numberOfPosts: integer("number_of_posts").notNull().default(3), // Posts per platform
  
  // Generation Settings
  includeImage: integer("include_image").notNull().default(1), // Boolean as 0/1
  includeVideo: integer("include_video").notNull().default(0), // Boolean as 0/1 - Generate 60s video
  imagePreference: varchar("image_preference", { length: 50 }), // hero, platform-specific, none
  autoShare: integer("auto_share").notNull().default(0), // Boolean as 0/1
  userEmail: varchar("user_email", { length: 255 }), // For mailto: hashtag links
  
  // Video Generation (60-second slideshow with voiceover)
  videoType: varchar("video_type", { length: 20 }).default("slideshow"), // "slideshow" (fast, 2-3 min) or "veo" (premium AI video, ~80 min)
  videoUrl: text("video_url"), // Permanent storage URL for generated video
  videoStatus: varchar("video_status", { length: 20 }), // PENDING, GENERATING, READY, FAILED
  videoProgress: integer("video_progress").default(0), // Progress percentage (0-100)
  videoStage: varchar("video_stage", { length: 50 }), // Current stage: queued, script, images, tts, composition, finalize
  videoDuration: integer("video_duration").default(60), // Video duration in seconds (default 60)
  videoScriptJson: jsonb("video_script_json"), // 4-scene script (15s each)
  videoGeneratedAt: timestamp("video_generated_at"), // When video was generated
  
  // Video SEO/GEO Metadata (for YouTube, TikTok, etc.)
  videoTitle: varchar("video_title", { length: 255 }), // SEO-optimized video title
  videoDescription: text("video_description"), // GEO-optimized video description
  videoTagsJson: jsonb("video_tags_json"), // Array of SEO/GEO tags for video platforms
  
  // SEO & GEO Data
  geoTagsJson: jsonb("geo_tags_json"), // City, neighborhood geo tags
  seoKeywordsJson: jsonb("seo_keywords_json"), // Primary + secondary keywords
  
  // Status Tracking
  status: varchar("status", { length: 50 }).notNull().default("PENDING"), // PENDING, GENERATING, READY, SCHEDULED, POSTED, FAILED
  scheduleAt: timestamp("schedule_at"), // Optional future posting time
  
  // Job Metadata
  jobId: varchar("job_id", { length: 255 }), // pg-boss job ID
  requestKey: varchar("request_key", { length: 255 }), // per-request idempotency key (composite unique with teamId below)
  errorMessage: text("error_message"),
  
  // Soft Delete Support
  deletedAt: timestamp("deleted_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("social_posts_public_id_idx").on(table.publicId),
  teamIdStatusIdx: index("social_posts_team_id_status_idx").on(table.teamId, table.status),
  userIdIdx: index("social_posts_user_id_idx").on(table.userId),
  statusIdx: index("social_posts_status_idx").on(table.status),
  scheduleAtIdx: index("social_posts_schedule_at_idx").on(table.scheduleAt),
  teamRequestKeyIdx: uniqueIndex("social_posts_team_request_key_idx").on(table.teamId, table.requestKey),
}));

// Social Post Variants table - one row per platform with generated content
export const socialPostVariants = pgTable("social_post_variants", {
  id: serial("id").primaryKey(),
  socialPostId: integer("social_post_id").notNull().references(() => socialPosts.id),
  platform: varchar("platform", { length: 20 }).notNull(), // x, facebook, instagram, linkedin, pinterest
  variantIndex: integer("variant_index").notNull().default(1), // Which variant number (1-N)
  
  // Generated Content
  caption: text("caption").notNull(), // AI-generated platform-specific caption
  characterCount: integer("character_count").notNull(),
  hashtags: text("hashtags"), // Space-separated hashtags for easy copy-paste
  hashtagsJson: jsonb("hashtags_json").notNull(), // Array of hashtags with mailto: links
  emojisJson: jsonb("emojis_json"), // Array of emojis used
  hyperlinksJson: jsonb("hyperlinks_json"), // Links embedded in caption
  
  // Platform-Specific Metadata
  characterLimit: integer("character_limit"), // Platform character limit (280 for X, etc.)
  aspectRatio: varchar("aspect_ratio", { length: 10 }), // Image aspect ratio (1:1, 4:5, 16:9)
  imageUrl: text("image_url"), // DALL-E generated image URL (permanent Replit storage)
  platformMetadata: jsonb("platform_metadata"), // Platform-specific fields (Twitter thread ID, IG alt text, etc.)
  
  // Status Tracking
  status: varchar("status", { length: 20 }).notNull().default("PENDING"), // PENDING, GENERATING, READY, FAILED
  errorMessage: text("error_message"), // Error details if status is FAILED
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  socialPostIdIdx: index("social_post_variants_social_post_id_idx").on(table.socialPostId),
  platformIdx: index("social_post_variants_platform_idx").on(table.platform),
  statusIdx: index("social_post_variants_status_idx").on(table.status),
}));

// Social Post Assets table - generated images and videos for social posts
export const socialPostAssets = pgTable("social_post_assets", {
  id: serial("id").primaryKey(),
  socialPostId: integer("social_post_id").notNull().references(() => socialPosts.id),
  variantId: integer("variant_id").references(() => socialPostVariants.id), // Optional: link to specific platform variant
  platform: varchar("platform", { length: 20 }).notNull(), // Platform this asset is optimized for
  
  // Asset Type
  assetType: varchar("asset_type", { length: 10 }).notNull().default("image"), // "image" or "video"
  
  // Common Data
  promptUsed: text("prompt_used").notNull(), // AI prompt used to generate this asset
  storageUrl: text("storage_url").notNull(), // Permanent Replit Object Storage URL
  altText: varchar("alt_text", { length: 255 }), // Accessibility text / description
  aspectRatio: varchar("aspect_ratio", { length: 10 }).notNull(), // "16:9", "1:1", "2:3", "1.91:1", "9:16"
  
  // Image-Specific Data
  width: integer("width"), // Image width in pixels
  height: integer("height"), // Image height in pixels
  fileFormat: varchar("file_format", { length: 10 }).notNull().default("webp"), // webp, mp4, etc.
  
  // Video-Specific Data
  videoDuration: integer("video_duration"), // Video duration in seconds (for videos)
  videoResolution: varchar("video_resolution", { length: 10 }), // "720p", "1080p" (for videos)
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  socialPostIdIdx: index("social_post_assets_social_post_id_idx").on(table.socialPostId),
  platformIdx: index("social_post_assets_platform_idx").on(table.platform),
  assetTypeIdx: index("social_post_assets_asset_type_idx").on(table.assetType),
}));

// Social Post Jobs table - tracks pg-boss job processing
export const socialPostJobs = pgTable("social_post_jobs", {
  id: serial("id").primaryKey(),
  socialPostId: integer("social_post_id").notNull().references(() => socialPosts.id),
  jobId: varchar("job_id", { length: 255 }).notNull().unique(), // pg-boss job ID
  jobType: varchar("job_type", { length: 50 }).notNull(), // GENERATION, SCHEDULING, POSTING
  status: varchar("status", { length: 50 }).notNull(), // PENDING, ACTIVE, COMPLETED, FAILED
  attempt: integer("attempt").notNull().default(1),
  maxAttempts: integer("max_attempts").notNull().default(3),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  socialPostIdIdx: index("social_post_jobs_social_post_id_idx").on(table.socialPostId),
  jobIdIdx: index("social_post_jobs_job_id_idx").on(table.jobId),
  statusIdx: index("social_post_jobs_status_idx").on(table.status),
}));

// Social Post Logs table - audit trail for social post actions
export const socialPostLogs = pgTable("social_post_logs", {
  id: serial("id").primaryKey(),
  socialPostId: integer("social_post_id").notNull().references(() => socialPosts.id),
  eventType: varchar("event_type", { length: 50 }).notNull(), // GENERATION_START, PLATFORM_GENERATED, IMAGE_GENERATED, READY, POSTED, FAILED
  stage: varchar("stage", { length: 50 }), // GEMINI, GPT4, IMAGE_GEN, POSTING
  message: text("message").notNull(),
  payloadJson: jsonb("payload_json"), // Additional event data
  severity: varchar("severity", { length: 20 }).notNull().default("info"), // info, warning, error
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  socialPostIdIdx: index("social_post_logs_social_post_id_idx").on(table.socialPostId),
  eventTypeIdx: index("social_post_logs_event_type_idx").on(table.eventType),
  severityIdx: index("social_post_logs_severity_idx").on(table.severity),
}));

// Error Logs table - system-wide error tracking
export const errorLogs = pgTable("error_logs", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").references(() => jobBatches.id),
  articleId: integer("article_id").references(() => articles.id),
  errorType: varchar("error_type", { length: 50 }).notNull(), // GEMINI, GPT4, SCHEMA, UPLOAD, QUEUE
  errorMessage: text("error_message").notNull(),
  stackTrace: text("stack_trace"),
  severity: varchar("severity", { length: 20 }).notNull().default("error"), // warning, error, critical
  resolved: integer("resolved").notNull().default(0), // Boolean as 0/1
  resolvedAt: timestamp("resolved_at"),
  screenshotUrl: text("screenshot_url"), // Optional UI screenshot for client-side errors
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  batchIdIdx: index("error_logs_batch_id_idx").on(table.batchId),
  articleIdIdx: index("error_logs_article_id_idx").on(table.articleId),
  errorTypeIdx: index("error_logs_error_type_idx").on(table.errorType),
  resolvedIdx: index("error_logs_resolved_idx").on(table.resolved),
}));

// Admin Action Logs table - audit trail for admin actions
export const adminActionLogs = pgTable("admin_action_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(), // DELETE_BATCH, REQUEUE_JOB, RESOLVE_ERROR, etc.
  targetType: varchar("target_type", { length: 50 }), // BATCH, ARTICLE, ERROR
  targetId: integer("target_id"),
  details: text("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("admin_action_logs_user_id_idx").on(table.userId),
  actionIdx: index("admin_action_logs_action_idx").on(table.action),
}));

// Article Versions table - content versioning and rollback
export const articleVersions = pgTable("article_versions", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").notNull().references(() => articles.id),
  versionNumber: integer("version_number").notNull(),
  finalHtmlContent: text("final_html_content").notNull(),
  seoTitle: varchar("seo_title", { length: 60 }),
  metaDescription: varchar("meta_description", { length: 160 }),
  keywordsJson: jsonb("keywords_json"),
  hashtagsJson: jsonb("hashtags_json"),
  geoAccuracyScore: integer("geo_accuracy_score"),
  wordCount: integer("word_count"),
  changeReason: text("change_reason"), // Why this version was created
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  articleIdIdx: index("article_versions_article_id_idx").on(table.articleId),
}));

// ============================================================================
// ADMIN MANAGEMENT TABLES - Phase 1, 2, 3 Features
// ============================================================================

// User Invites table - invite team members with expiring links
export const userInvites = pgTable("user_invites", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  invitedBy: integer("invited_by").notNull().references(() => users.id),
  teamId: integer("team_id").references(() => teams.id),
  role: varchar("role", { length: 50 }).notNull().default("team_member"), // admin, team_member
  
  // Invite Token
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 hash of invite token
  expiresAt: timestamp("expires_at").notNull(),
  
  // Status Tracking
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, accepted, expired, cancelled
  acceptedAt: timestamp("accepted_at"),
  acceptedBy: integer("accepted_by").references(() => users.id), // Created user ID
  
  // Metadata
  message: text("message"), // Optional personal message from inviter
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  emailIdx: index("user_invites_email_idx").on(table.email),
  tokenHashIdx: index("user_invites_token_hash_idx").on(table.tokenHash),
  statusIdx: index("user_invites_status_idx").on(table.status),
  expiresAtIdx: index("user_invites_expires_at_idx").on(table.expiresAt),
}));

// Login History table - comprehensive login tracking with geo/IP
export const loginHistory = pgTable("login_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id), // Nullable for failed login attempts
  email: varchar("email", { length: 255 }).notNull(), // Store email even for failed attempts
  
  // Login Outcome
  success: integer("success").notNull(), // Boolean as 0/1
  failureReason: varchar("failure_reason", { length: 100 }), // wrong_password, account_locked, 2fa_failed, etc.
  
  // Request Context
  ipAddress: varchar("ip_address", { length: 255 }).notNull(),
  userAgent: text("user_agent"),
  
  // Geo Location (populated asynchronously)
  country: varchar("country", { length: 2 }), // ISO country code
  region: varchar("region", { length: 100 }),
  city: varchar("city", { length: 100 }),
  latitude: varchar("latitude", { length: 20 }),
  longitude: varchar("longitude", { length: 20 }),
  
  // Device Info (parsed from user agent)
  deviceType: varchar("device_type", { length: 20 }), // desktop, mobile, tablet
  browser: varchar("browser", { length: 50 }),
  os: varchar("os", { length: 50 }),
  
  // Session Reference
  sessionId: integer("session_id").references(() => sessions.id),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("login_history_user_id_idx").on(table.userId),
  emailIdx: index("login_history_email_idx").on(table.email),
  successIdx: index("login_history_success_idx").on(table.success),
  ipAddressIdx: index("login_history_ip_address_idx").on(table.ipAddress),
  createdAtIdx: index("login_history_created_at_idx").on(table.createdAt),
}));

// Password Resets table - admin password reset override tracking
export const passwordResets = pgTable("password_resets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  initiatedBy: integer("initiated_by").references(() => users.id), // Admin who initiated override
  resetType: varchar("reset_type", { length: 20 }).notNull(), // admin_override, user_request
  
  // Reset Token
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  
  // Status
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, used, expired, cancelled
  usedAt: timestamp("used_at"),
  
  // Context
  ipAddress: varchar("ip_address", { length: 255 }),
  reason: text("reason"), // Admin override reason
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("password_resets_user_id_idx").on(table.userId),
  tokenHashIdx: index("password_resets_token_hash_idx").on(table.tokenHash),
  statusIdx: index("password_resets_status_idx").on(table.status),
}));

// User Quotas table - usage limits per user/role
export const userQuotas = pgTable("user_quotas", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id), // Nullable for role-based quotas
  role: varchar("role", { length: 50 }), // For role-based quotas
  
  // Quota Limits
  quotaType: varchar("quota_type", { length: 50 }).notNull(), // articles_per_day, social_posts_per_day, videos_per_day, api_calls_per_hour
  limitValue: integer("limit_value").notNull(), // Maximum allowed
  periodType: varchar("period_type", { length: 20 }).notNull(), // hour, day, week, month
  
  // Current Usage (resets based on period)
  currentUsage: integer("current_usage").notNull().default(0),
  periodStartsAt: timestamp("period_starts_at").notNull().defaultNow(),
  periodEndsAt: timestamp("period_ends_at").notNull(),
  
  // Metadata
  enabled: integer("enabled").notNull().default(1), // Boolean as 0/1
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("user_quotas_user_id_idx").on(table.userId),
  roleIdx: index("user_quotas_role_idx").on(table.role),
  quotaTypeIdx: index("user_quotas_quota_type_idx").on(table.quotaType),
}));

// System Metrics table - health monitoring data
export const systemMetrics = pgTable("system_metrics", {
  id: serial("id").primaryKey(),
  
  // Resource Usage
  cpuUsagePercent: integer("cpu_usage_percent"), // 0-100
  memoryUsageMb: integer("memory_usage_mb"),
  memoryTotalMb: integer("memory_total_mb"),
  diskUsageMb: integer("disk_usage_mb"),
  diskTotalMb: integer("disk_total_mb"),
  
  // Queue Status
  queueDepthArticles: integer("queue_depth_articles").notNull().default(0),
  queueDepthSocialPosts: integer("queue_depth_social_posts").notNull().default(0),
  queueDepthVideos: integer("queue_depth_videos").notNull().default(0),
  activeWorkers: integer("active_workers").notNull().default(0),
  
  // FFmpeg Status
  ffmpegJobsActive: integer("ffmpeg_jobs_active").notNull().default(0),
  ffmpegJobsFailed: integer("ffmpeg_jobs_failed").notNull().default(0),
  
  // API Health
  geminiApiStatus: varchar("gemini_api_status", { length: 20 }).notNull().default("healthy"), // healthy, degraded, down
  openaiApiStatus: varchar("openai_api_status", { length: 20 }).notNull().default("healthy"),
  databaseStatus: varchar("database_status", { length: 20 }).notNull().default("healthy"),
  
  // Timestamp
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
}, (table) => ({
  recordedAtIdx: index("system_metrics_recorded_at_idx").on(table.recordedAt),
}));

// Maintenance Flags table - system-wide maintenance mode and feature toggles
export const maintenanceFlags = pgTable("maintenance_flags", {
  id: serial("id").primaryKey(),
  flagKey: varchar("flag_key", { length: 100 }).notNull().unique(), // maintenance_mode, 2fa_required, new_user_signups_enabled, etc.
  flagValue: integer("flag_value").notNull().default(0), // Boolean as 0/1
  description: text("description"),
  
  // Change Tracking
  lastModifiedBy: integer("last_modified_by").references(() => users.id),
  lastModifiedAt: timestamp("last_modified_at").notNull().defaultNow(),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  flagKeyIdx: index("maintenance_flags_flag_key_idx").on(table.flagKey),
}));

// ============================================================================
// CLEANUP & MAINTENANCE TABLES - Automated system cleanup jobs
// ============================================================================

// Cleanup Jobs table - tracks automated cleanup job executions
export const cleanupJobs = pgTable("cleanup_jobs", {
  id: serial("id").primaryKey(),
  jobType: varchar("job_type", { length: 50 }).notNull(), // media_cleanup, log_rotation, orphan_cleanup, user_expiry
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, running, completed, failed
  itemsProcessed: integer("items_processed").notNull().default(0),
  itemsDeleted: integer("items_deleted").notNull().default(0),
  errorMessage: text("error_message"),
  dryRun: integer("dry_run").notNull().default(0), // Boolean as 0/1
  
  // Execution Times
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  jobTypeIdx: index("cleanup_jobs_job_type_idx").on(table.jobType),
  statusIdx: index("cleanup_jobs_status_idx").on(table.status),
  createdAtIdx: index("cleanup_jobs_created_at_idx").on(table.createdAt),
}));

// Cleanup Configuration table - stores retention policies and cleanup settings
export const cleanupConfig = pgTable("cleanup_config", {
  id: serial("id").primaryKey(),
  settingKey: varchar("setting_key", { length: 100 }).notNull().unique(),
  settingValue: jsonb("setting_value").notNull(), // e.g., {"media_retention_days": 90, "log_retention_days": 60}
  description: text("description"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: integer("updated_by").references(() => users.id),
}, (table) => ({
  settingKeyIdx: index("cleanup_config_setting_key_idx").on(table.settingKey),
}));

// ============================================================================
// CONTENT CLUSTER TRACKING - Advanced local SEO coverage depth
// ============================================================================

// Content Clusters table - tracks topic pillars for comprehensive local coverage
export const contentClusters = pgTable("content_clusters", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  teamId: integer("team_id").references(() => teams.id),
  
  // Cluster Identity
  topicPillar: varchar("topic_pillar", { length: 255 }).notNull(), // e.g., "senior care", "dental services"
  location: varchar("location", { length: 255 }).notNull(), // City or region
  localeId: integer("locale_id").references(() => locales.id),
  
  // Coverage Tracking
  status: varchar("status", { length: 20 }).notNull().default("planning"), // planning, in_progress, complete
  totalNodesPlanned: integer("total_nodes_planned").notNull().default(0), // Total subtopics to cover
  totalNodesComplete: integer("total_nodes_complete").notNull().default(0), // Completed subtopics
  
  // Metadata
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  publicIdIdx: index("content_clusters_public_id_idx").on(table.publicId),
  teamIdIdx: index("content_clusters_team_id_idx").on(table.teamId),
  topicLocationIdx: index("content_clusters_topic_location_idx").on(table.topicPillar, table.location),
  statusIdx: index("content_clusters_status_idx").on(table.status),
}));

// Coverage Nodes table - tracks individual subtopic coverage within clusters
export const coverageNodes = pgTable("coverage_nodes", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  clusterId: integer("cluster_id").notNull().references(() => contentClusters.id, { onDelete: 'cascade' }),
  
  // Node Identity
  subtopicCategory: varchar("subtopic_category", { length: 100 }).notNull(), // types, costs, laws, providers, testimonials, faqs, best_practices, neighborhoods
  subtopicTitle: varchar("subtopic_title", { length: 255 }).notNull(), // Specific subtopic title
  
  // Content Coverage
  articleId: integer("article_id").references(() => articles.id), // Linked article covering this node
  depthScore: integer("depth_score").notNull().default(0), // 0-100, measures completeness
  localSignalStrength: integer("local_signal_strength").notNull().default(0), // 0-100, local relevance
  eatScore: integer("eat_score").notNull().default(0), // 0-100, E-E-A-T alignment
  
  // Status
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, drafted, published
  
  // Metadata
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("coverage_nodes_public_id_idx").on(table.publicId),
  clusterIdIdx: index("coverage_nodes_cluster_id_idx").on(table.clusterId),
  subtopicCategoryIdx: index("coverage_nodes_subtopic_category_idx").on(table.subtopicCategory),
  articleIdIdx: index("coverage_nodes_article_id_idx").on(table.articleId),
  statusIdx: index("coverage_nodes_status_idx").on(table.status),
}));

// Local Authority Signals table - stores local entities and citations for E-E-A-T
export const localAuthoritySignals = pgTable("local_authority_signals", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  
  // Entity Identity
  entityName: varchar("entity_name", { length: 255 }).notNull(), // Local org, expert, landmark
  entityType: varchar("entity_type", { length: 50 }).notNull(), // organization, expert, landmark, regulation, statistic
  location: varchar("location", { length: 255 }).notNull(), // City or region
  
  // Citation Data
  citationUrl: text("citation_url"), // Source URL for verification
  citationText: text("citation_text"), // Quotable text or data point
  credibilityScore: integer("credibility_score").notNull().default(0), // 0-100
  
  // Freshness
  freshnessDate: timestamp("freshness_date"), // Last verified or published date
  isVerified: integer("is_verified").notNull().default(0), // Boolean as 0/1
  
  // Usage Tracking
  timesUsed: integer("times_used").notNull().default(0), // How many articles reference this
  lastUsedAt: timestamp("last_used_at"),
  
  // Metadata
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("local_authority_signals_public_id_idx").on(table.publicId),
  entityTypeLocationIdx: index("local_authority_signals_entity_type_location_idx").on(table.entityType, table.location),
  locationIdx: index("local_authority_signals_location_idx").on(table.location),
  freshnessDateIdx: index("local_authority_signals_freshness_date_idx").on(table.freshnessDate),
}));

// ============================================================================
// VIDEO IDEAS TABLE - Transforms brief ideas into full video productions
// ============================================================================

export const videoIdeas = pgTable("video_ideas", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  userId: integer("user_id").notNull().references(() => users.id),
  teamId: integer("team_id").references(() => teams.id),
  socialPostId: integer("social_post_id").references(() => socialPosts.id), // Optional link to social post
  
  // User Input - Brief Idea
  ideaTitle: varchar("idea_title", { length: 255 }).notNull(), // Short title for the video
  shortIdea: text("short_idea").notNull(), // Brief description (1-3 sentences)
  targetAudience: varchar("target_audience", { length: 255 }), // Who is this for?
  
  // Company Branding
  companyName: varchar("company_name", { length: 255 }), // Business name
  website: varchar("website", { length: 500 }), // Company website
  callToAction: varchar("call_to_action", { length: 255 }).notNull().default("Get Started Today!"), // CTA text
  companyLogoUrl: text("company_logo_url"), // Logo for overlay
  
  // Style & Tone Selection (from reference: 8 styles, 6 tones)
  style: varchar("style", { length: 50 }).notNull().default("cinematic"), // cinematic, comedy, emotional, tech, minimal, retro, luxury, action
  tone: varchar("tone", { length: 50 }).notNull().default("professional"), // professional, playful, inspirational, urgent, mysterious, friendly
  
  // AI-Expanded Concept (Hook → Problem → Solution → Benefits → Proof → CTA)
  expandedConceptJson: jsonb("expanded_concept_json"), // Structured JSON from Gemini expansion
  
  // Generated Script & Video
  scriptJson: jsonb("script_json"), // 10-clip video script with prompts/narration
  videoUrl: text("video_url"), // Final video URL
  thumbnailUrl: text("thumbnail_url"), // Video thumbnail
  
  // Status & Progress
  status: varchar("status", { length: 50 }).notNull().default("DRAFT"), // DRAFT, EXPANDING, SCRIPTING, GENERATING, STITCHING, READY, FAILED
  progress: integer("progress").notNull().default(0), // 0-100
  currentStage: varchar("current_stage", { length: 50 }), // expand_idea, generate_script, generate_tts, generate_clips, stitch_video
  errorMessage: text("error_message"),
  
  // Job Tracking
  jobId: varchar("job_id", { length: 255 }), // pg-boss job ID
  
  // Video Metadata (after generation)
  videoDuration: integer("video_duration").default(60), // Duration in seconds
  videoResolution: varchar("video_resolution", { length: 20 }).default("1920x1080"),
  
  // "Like Video" Reference Analysis
  referenceVideoUrl: text("reference_video_url"), // Source video URL or uploaded path
  referenceAnalysisJson: jsonb("reference_analysis_json"), // Frame/audio/pacing analysis results
  stylePrompt: text("style_prompt"), // Generated style prompt from analysis
  isLikeVideo: boolean("is_like_video").notNull().default(false), // Whether this was created via "Like Video"
  
  // Soft Delete
  deletedAt: timestamp("deleted_at"),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  generatedAt: timestamp("generated_at"), // When video was completed
}, (table) => ({
  publicIdIdx: index("video_ideas_public_id_idx").on(table.publicId),
  teamIdStatusIdx: index("video_ideas_team_id_status_idx").on(table.teamId, table.status),
  userIdIdx: index("video_ideas_user_id_idx").on(table.userId),
  styleIdx: index("video_ideas_style_idx").on(table.style),
  statusIdx: index("video_ideas_status_idx").on(table.status),
}));

// ============================================================================
// AI LEARNING SYSTEM - Adaptive content optimization
// ============================================================================

// Content type enum for learning specialization
export const ContentType = {
  ARTICLE: "article",
  VIDEO: "video",
  SOCIAL: "social",
  PODCAST: "podcast",
  IMAGE: "image",
} as const;

// Learning Agents - Specialized AI agents for each content type
export const learningAgents = pgTable("learning_agents", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  teamId: integer("team_id").references(() => teams.id),
  
  // Agent Identity
  contentType: varchar("content_type", { length: 50 }).notNull(), // article, video, social, podcast, image
  name: varchar("name", { length: 255 }).notNull(), // e.g., "Article Optimization Agent"
  description: text("description"),
  
  // Model Configuration (auto-refreshed to latest)
  primaryModel: varchar("primary_model", { length: 100 }).notNull(), // gemini-2.5-flash, gpt-4o, etc.
  fallbackModel: varchar("fallback_model", { length: 100 }), // Backup model
  temperature: integer("temperature").notNull().default(70), // 0-100 (divide by 100 for actual)
  
  // Learning Configuration
  learningRate: integer("learning_rate").notNull().default(10), // EMA alpha * 100 (default 0.1)
  minSampleSize: integer("min_sample_size").notNull().default(5), // Min samples before applying patterns
  confidenceThreshold: integer("confidence_threshold").notNull().default(60), // 0-100, min confidence to use pattern
  
  // Performance Tracking
  totalGenerations: integer("total_generations").notNull().default(0),
  successfulGenerations: integer("successful_generations").notNull().default(0),
  averageQualityScore: integer("average_quality_score").notNull().default(0), // 0-100
  
  // Status
  isActive: integer("is_active").notNull().default(1), // Boolean as 0/1
  lastOptimizedAt: timestamp("last_optimized_at"),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("learning_agents_public_id_idx").on(table.publicId),
  teamIdContentTypeIdx: index("learning_agents_team_content_type_idx").on(table.teamId, table.contentType),
  contentTypeIdx: index("learning_agents_content_type_idx").on(table.contentType),
  isActiveIdx: index("learning_agents_is_active_idx").on(table.isActive),
}));

// Learning Patterns - Successful patterns learned from content performance
export const learningPatterns = pgTable("learning_patterns", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  agentId: integer("agent_id").notNull().references(() => learningAgents.id, { onDelete: 'cascade' }),
  teamId: integer("team_id").references(() => teams.id),
  
  // Pattern Identity
  patternType: varchar("pattern_type", { length: 100 }).notNull(), // opening_style, hook, tone, cta, structure, visual_style, etc.
  patternName: varchar("pattern_name", { length: 255 }).notNull(), // Human-readable name
  patternValue: text("pattern_value").notNull(), // The actual pattern (prompt fragment, style, etc.)
  
  // Context (when to apply this pattern)
  contentType: varchar("content_type", { length: 50 }).notNull(), // article, video, social, podcast, image
  industry: varchar("industry", { length: 100 }), // Optional industry filter
  audience: varchar("audience", { length: 255 }), // Optional audience filter
  
  // Performance Metrics (EMA-weighted)
  successRate: integer("success_rate").notNull().default(50), // 0-100, EMA of success
  engagementScore: integer("engagement_score").notNull().default(50), // 0-100, EMA of engagement
  qualityScore: integer("quality_score").notNull().default(50), // 0-100, EMA of quality
  confidence: integer("confidence").notNull().default(0), // 0-100, based on sample size
  
  // Usage Tracking
  timesUsed: integer("times_used").notNull().default(0),
  timesSuccessful: integer("times_successful").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("learning_patterns_public_id_idx").on(table.publicId),
  agentIdIdx: index("learning_patterns_agent_id_idx").on(table.agentId),
  teamIdContentTypeIdx: index("learning_patterns_team_content_type_idx").on(table.teamId, table.contentType),
  patternTypeIdx: index("learning_patterns_pattern_type_idx").on(table.patternType),
  successRateIdx: index("learning_patterns_success_rate_idx").on(table.successRate),
}));

// Content Performance Metrics - Tracks engagement for learning feedback
export const contentPerformanceMetrics = pgTable("content_performance_metrics", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  teamId: integer("team_id").references(() => teams.id),
  
  // Content Reference (polymorphic - one of these will be set)
  contentType: varchar("content_type", { length: 50 }).notNull(), // article, video, social, podcast, image
  articleId: integer("article_id").references(() => articles.id, { onDelete: 'cascade' }),
  socialPostId: integer("social_post_id").references(() => socialPosts.id, { onDelete: 'cascade' }),
  videoIdeaId: integer("video_idea_id").references(() => videoIdeas.id, { onDelete: 'cascade' }),
  
  // Patterns Used (for attribution)
  patternsUsedJson: jsonb("patterns_used_json"), // Array of pattern IDs used
  
  // Engagement Metrics
  views: integer("views").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  timeOnPage: integer("time_on_page").notNull().default(0), // Seconds
  bounceRate: integer("bounce_rate").notNull().default(0), // 0-100
  
  // Quality Signals
  qualityScore: integer("quality_score").notNull().default(0), // 0-100, from AI critique
  eatScore: integer("eat_score").notNull().default(0), // 0-100, E-E-A-T score
  readabilityScore: integer("readability_score").notNull().default(0), // 0-100
  
  // Outcome
  isSuccess: integer("is_success"), // Boolean as 0/1/null (null = not yet determined)
  successReason: text("success_reason"), // Why it succeeded/failed
  
  // Learning Status
  feedbackProcessed: integer("feedback_processed").notNull().default(0), // Boolean as 0/1
  processedAt: timestamp("processed_at"),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("content_performance_public_id_idx").on(table.publicId),
  teamIdContentTypeIdx: index("content_performance_team_content_type_idx").on(table.teamId, table.contentType),
  articleIdIdx: index("content_performance_article_id_idx").on(table.articleId),
  socialPostIdIdx: index("content_performance_social_post_id_idx").on(table.socialPostId),
  videoIdeaIdIdx: index("content_performance_video_idea_id_idx").on(table.videoIdeaId),
  feedbackProcessedIdx: index("content_performance_feedback_processed_idx").on(table.feedbackProcessed),
  isSuccessIdx: index("content_performance_is_success_idx").on(table.isSuccess),
}));

// Agent Optimization Log - Tracks when agents are optimized
export const agentOptimizationLogs = pgTable("agent_optimization_logs", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => learningAgents.id, { onDelete: 'cascade' }),
  
  // Optimization Details
  optimizationType: varchar("optimization_type", { length: 50 }).notNull(), // pattern_update, model_refresh, threshold_adjust
  description: text("description"),
  
  // Before/After Metrics
  beforeMetricsJson: jsonb("before_metrics_json"),
  afterMetricsJson: jsonb("after_metrics_json"),
  
  // What Changed
  changesAppliedJson: jsonb("changes_applied_json"), // Array of changes made
  patternsUpdated: integer("patterns_updated").notNull().default(0),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  agentIdIdx: index("agent_optimization_logs_agent_id_idx").on(table.agentId),
  optimizationTypeIdx: index("agent_optimization_logs_type_idx").on(table.optimizationType),
  createdAtIdx: index("agent_optimization_logs_created_at_idx").on(table.createdAt),
}));

// Insert schemas for learning system
export const insertLearningAgentSchema = createInsertSchema(learningAgents).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLearningPatternSchema = createInsertSchema(learningPatterns).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertContentPerformanceMetricSchema = createInsertSchema(contentPerformanceMetrics).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAgentOptimizationLogSchema = createInsertSchema(agentOptimizationLogs).omit({
  id: true,
  createdAt: true,
});

// ============================================================================
// PSYCHOGRAPHIC TARGETING & PERSONAS (OCEAN Big Five Personality Model)
// ============================================================================

// Audience Personas - OCEAN-based psychographic profiles for content targeting
export const audiencePersonas = pgTable("audience_personas", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: 'cascade' }),
  
  // Persona Identity
  name: varchar("name", { length: 255 }).notNull(), // e.g., "Health-Conscious Professional"
  description: text("description"), // Detailed persona description
  avatarUrl: text("avatar_url"), // Optional persona avatar
  
  // OCEAN Big Five Personality Traits (0-100 scale)
  // Higher scores = stronger trait presence
  openness: integer("openness").notNull().default(50), // Creativity, curiosity, open to new experiences
  conscientiousness: integer("conscientiousness").notNull().default(50), // Organization, dependability, self-discipline
  extraversion: integer("extraversion").notNull().default(50), // Sociability, assertiveness, energy
  agreeableness: integer("agreeableness").notNull().default(50), // Cooperation, trust, empathy
  neuroticism: integer("neuroticism").notNull().default(50), // Emotional sensitivity, anxiety tendency
  
  // Psychographic Modifiers
  riskTolerance: integer("risk_tolerance").notNull().default(50), // 0=risk-averse, 100=risk-seeking
  decisionStyle: varchar("decision_style", { length: 50 }).default("balanced"), // analytical, emotional, balanced, impulsive
  valueOrientation: varchar("value_orientation", { length: 50 }).default("balanced"), // price, quality, experience, status
  
  // Demographics (optional context)
  ageRangeMin: integer("age_range_min"),
  ageRangeMax: integer("age_range_max"),
  gender: varchar("gender", { length: 50 }), // any, male, female, non-binary
  incomeLevel: varchar("income_level", { length: 50 }), // low, middle, upper-middle, high
  education: varchar("education", { length: 100 }), // high-school, some-college, bachelors, graduate, professional
  
  // Behavioral Traits (learned from interactions)
  preferredContentLength: varchar("preferred_content_length", { length: 50 }).default("medium"), // short, medium, long, detailed
  preferredTone: varchar("preferred_tone", { length: 50 }).default("professional"), // casual, professional, authoritative, friendly, urgent
  preferredFormat: varchar("preferred_format", { length: 50 }).default("mixed"), // listicles, narratives, how-to, data-driven, mixed
  engagementTimePreference: varchar("engagement_time_preference", { length: 50 }), // morning, afternoon, evening, night
  
  // Content Preferences (JSON arrays)
  topicsOfInterest: jsonb("topics_of_interest"), // ["health", "finance", "technology"]
  painPoints: jsonb("pain_points"), // ["time management", "cost concerns"]
  motivations: jsonb("motivations"), // ["save money", "improve health", "career advancement"]
  objections: jsonb("objections"), // ["too expensive", "not enough time", "skeptical of claims"]
  
  // Messaging Guidelines
  emotionalTriggers: jsonb("emotional_triggers"), // ["fear of missing out", "desire for security"]
  avoidPhrases: jsonb("avoid_phrases"), // ["cheap", "easy", "guaranteed"]
  preferredPhrases: jsonb("preferred_phrases"), // ["invest in yourself", "proven results"]
  ctaStyle: varchar("cta_style", { length: 100 }).default("value-first"), // direct, soft, value-first, urgency, social-proof
  
  // Performance Tracking
  totalContentGenerated: integer("total_content_generated").notNull().default(0),
  avgEngagementRate: integer("avg_engagement_rate").notNull().default(0), // 0-100
  avgConversionRate: integer("avg_conversion_rate").notNull().default(0), // 0-100
  
  // Status
  isActive: integer("is_active").notNull().default(1),
  isDefault: integer("is_default").notNull().default(0), // One default persona per team
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("audience_personas_public_id_idx").on(table.publicId),
  teamIdIdx: index("audience_personas_team_id_idx").on(table.teamId),
  isActiveIdx: index("audience_personas_is_active_idx").on(table.isActive),
  isDefaultIdx: index("audience_personas_is_default_idx").on(table.isDefault),
}));

// Persona Messaging Templates - Pre-built message templates for each persona
export const personaMessagingTemplates = pgTable("persona_messaging_templates", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  personaId: integer("persona_id").notNull().references(() => audiencePersonas.id, { onDelete: 'cascade' }),
  
  // Template Identity
  name: varchar("name", { length: 255 }).notNull(), // e.g., "Urgency Hook for Risk-Averse"
  contentType: varchar("content_type", { length: 50 }).notNull(), // article, video, social, email
  templateType: varchar("template_type", { length: 100 }).notNull(), // hook, opening, cta, objection_handler, benefit_statement
  
  // The Template
  template: text("template").notNull(), // The actual template with {{placeholders}}
  
  // When to Use
  triggerCondition: varchar("trigger_condition", { length: 255 }), // e.g., "when neuroticism > 60"
  
  // Performance
  timesUsed: integer("times_used").notNull().default(0),
  successRate: integer("success_rate").notNull().default(50), // 0-100
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("persona_messaging_templates_public_id_idx").on(table.publicId),
  personaIdIdx: index("persona_messaging_templates_persona_id_idx").on(table.personaId),
  contentTypeIdx: index("persona_messaging_templates_content_type_idx").on(table.contentType),
  templateTypeIdx: index("persona_messaging_templates_template_type_idx").on(table.templateType),
}));

// Persona Behavioral Signals - Track user interactions to refine personas
export const personaBehavioralSignals = pgTable("persona_behavioral_signals", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  personaId: integer("persona_id").notNull().references(() => audiencePersonas.id, { onDelete: 'cascade' }),
  
  // Signal Type
  signalType: varchar("signal_type", { length: 100 }).notNull(), // content_engagement, cta_click, time_on_page, scroll_depth, share, bounce
  
  // Content Reference
  contentType: varchar("content_type", { length: 50 }).notNull(),
  contentId: integer("content_id").notNull(),
  
  // Signal Value
  signalValue: integer("signal_value").notNull(), // Engagement score, time in seconds, percentage, etc.
  signalMetadata: jsonb("signal_metadata"), // Additional context
  
  // Pattern Used (for learning attribution)
  patternsUsedJson: jsonb("patterns_used_json"),
  messagingTemplateId: integer("messaging_template_id").references(() => personaMessagingTemplates.id),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("persona_behavioral_signals_public_id_idx").on(table.publicId),
  personaIdIdx: index("persona_behavioral_signals_persona_id_idx").on(table.personaId),
  signalTypeIdx: index("persona_behavioral_signals_signal_type_idx").on(table.signalType),
  contentTypeIdx: index("persona_behavioral_signals_content_type_idx").on(table.contentType),
  createdAtIdx: index("persona_behavioral_signals_created_at_idx").on(table.createdAt),
}));

// Insert schemas for psychographic system
export const insertAudiencePersonaSchema = createInsertSchema(audiencePersonas).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPersonaMessagingTemplateSchema = createInsertSchema(personaMessagingTemplates).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPersonaBehavioralSignalSchema = createInsertSchema(personaBehavioralSignals).omit({
  id: true,
  publicId: true,
  createdAt: true,
});

// Type exports for psychographic system
export type AudiencePersona = typeof audiencePersonas.$inferSelect;
export type InsertAudiencePersona = z.infer<typeof insertAudiencePersonaSchema>;
export type PersonaMessagingTemplate = typeof personaMessagingTemplates.$inferSelect;
export type InsertPersonaMessagingTemplate = z.infer<typeof insertPersonaMessagingTemplateSchema>;
export type PersonaBehavioralSignal = typeof personaBehavioralSignals.$inferSelect;
export type InsertPersonaBehavioralSignal = z.infer<typeof insertPersonaBehavioralSignalSchema>;

// ============================================================================
// ANTI-HALLUCINATION FRAMEWORK - Fact Store & Evidence Binding System
// ============================================================================

// Fact source types
export const FactSourceType = {
  WEBSITE: "website",
  DOCUMENT: "document",
  API: "api",
  USER_INPUT: "user_input",
  VERIFIED_DATABASE: "verified_database",
} as const;

// Fact verification status
export const FactStatus = {
  ACTIVE: "active",
  EXPIRED: "expired",
  REVOKED: "revoked",
  PENDING_REVIEW: "pending_review",
} as const;

// Claim classification types
export const ClaimClass = {
  DIRECT_FACT: "direct_fact",       // Directly from fact store
  REPHRASE: "rephrase",             // Rephrased version of fact
  DERIVED: "derived",               // Aggregated/combined from multiple facts
  ASSUMPTION: "assumption",         // REJECTED - guessed/assumed
  GUESS: "guess",                   // REJECTED - speculation
  INDUSTRY_GENERIC: "industry_generic", // REJECTED - generic boilerplate
} as const;

// Validation status for claims
export const ValidationStatus = {
  APPROVED: "approved",
  REJECTED: "rejected",
  INSUFFICIENT_DATA: "insufficient_data",
  PENDING: "pending",
} as const;

// Facts table - Immutable fact store (single source of truth)
export const facts = pgTable("facts", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: 'cascade' }),
  
  // Fact Identity (atomic - one claim per fact)
  factText: text("fact_text").notNull(), // The actual fact statement
  entityType: varchar("entity_type", { length: 100 }), // company, service, product, location, etc.
  entityName: varchar("entity_name", { length: 255 }), // Specific entity this fact is about
  
  // Source Attribution
  sourceType: varchar("source_type", { length: 50 }).notNull(), // website, document, api, user_input
  sourceUrl: text("source_url"), // URL or path to source
  sourceExcerpt: text("source_excerpt"), // Relevant excerpt from source
  
  // Verification
  verifiedBy: varchar("verified_by", { length: 100 }).notNull(), // human, automated_scrape, api_sync
  verifiedAt: timestamp("verified_at").notNull().defaultNow(),
  verifierId: integer("verifier_id").references(() => users.id), // Human verifier if applicable
  
  // Confidence & Validity
  confidence: integer("confidence").notNull().default(80), // 0-100 confidence score
  expiresAt: timestamp("expires_at"), // TTL for time-sensitive facts
  status: varchar("status", { length: 20 }).notNull().default("active"), // active, expired, revoked, pending_review
  
  // Version Control (facts are immutable; new versions create new records)
  version: integer("version").notNull().default(1),
  previousVersionId: integer("previous_version_id").references((): any => facts.id),
  
  // Metadata
  tags: text("tags").array(), // Searchable tags
  category: varchar("category", { length: 100 }), // business_info, service, pricing, location, etc.
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("facts_public_id_idx").on(table.publicId),
  teamIdIdx: index("facts_team_id_idx").on(table.teamId),
  teamIdStatusIdx: index("facts_team_status_idx").on(table.teamId, table.status),
  entityTypeIdx: index("facts_entity_type_idx").on(table.entityType),
  categoryIdx: index("facts_category_idx").on(table.category),
  expiresAtIdx: index("facts_expires_at_idx").on(table.expiresAt),
  confidenceIdx: index("facts_confidence_idx").on(table.confidence),
}));

// Fact Versions - Immutable history of all fact changes
export const factVersions = pgTable("fact_versions", {
  id: serial("id").primaryKey(),
  factId: integer("fact_id").notNull().references(() => facts.id, { onDelete: 'cascade' }),
  
  // Snapshot of fact at this version
  version: integer("version").notNull(),
  factText: text("fact_text").notNull(),
  sourceType: varchar("source_type", { length: 50 }).notNull(),
  sourceUrl: text("source_url"),
  confidence: integer("confidence").notNull(),
  
  // Change Metadata
  changedBy: integer("changed_by").references(() => users.id),
  changeReason: text("change_reason"),
  
  // Immutable timestamp
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  factIdIdx: index("fact_versions_fact_id_idx").on(table.factId),
  factIdVersionIdx: uniqueIndex("fact_versions_fact_version_unique").on(table.factId, table.version),
}));

// Fact Claims - Sentence-level binding to facts for generated content
export const factClaims = pgTable("fact_claims", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  
  // Content Reference
  contentType: varchar("content_type", { length: 50 }).notNull(), // article, social, video, podcast
  contentId: integer("content_id").notNull(), // Reference to article/social post/video/podcast
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: 'cascade' }),
  
  // Claim Details
  sentenceIndex: integer("sentence_index").notNull(), // Position in content
  claimText: text("claim_text").notNull(), // The generated sentence/claim
  
  // Evidence Binding
  factIds: integer("fact_ids").array().notNull(), // Array of fact IDs this claim is bound to
  claimClass: varchar("claim_class", { length: 50 }).notNull(), // direct_fact, rephrase, derived, assumption (rejected), etc.
  
  // Confidence & Validation
  confidence: integer("confidence").notNull(), // Aggregate confidence from bound facts
  validationStatus: varchar("validation_status", { length: 30 }).notNull(), // approved, rejected, insufficient_data
  validatorAgent: varchar("validator_agent", { length: 100 }), // Which validator checked this
  rejectionReason: text("rejection_reason"), // Why it was rejected (if applicable)
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("fact_claims_public_id_idx").on(table.publicId),
  contentTypeIdIdx: index("fact_claims_content_type_id_idx").on(table.contentType, table.contentId),
  teamIdIdx: index("fact_claims_team_id_idx").on(table.teamId),
  validationStatusIdx: index("fact_claims_validation_status_idx").on(table.validationStatus),
  claimClassIdx: index("fact_claims_claim_class_idx").on(table.claimClass),
}));

// Content Audit Trails - Complete audit log for generated content
export const contentAuditTrails = pgTable("content_audit_trails", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  
  // Content Reference
  contentType: varchar("content_type", { length: 50 }).notNull(), // article, social, video, podcast
  contentId: integer("content_id").notNull(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: 'cascade' }),
  
  // Fact Usage Summary
  factsUsed: integer("facts_used").array().notNull(), // Array of fact IDs used
  factsRequested: integer("facts_requested").notNull(), // How many facts were requested
  factsCovered: integer("facts_covered").notNull(), // How many were actually used
  
  // Confidence Metrics
  avgConfidence: integer("avg_confidence").notNull(), // Average confidence of used facts
  minConfidence: integer("min_confidence").notNull(), // Minimum confidence in the set
  confidenceThreshold: integer("confidence_threshold").notNull(), // What was the threshold
  
  // Validation Summary
  totalClaims: integer("total_claims").notNull().default(0),
  approvedClaims: integer("approved_claims").notNull().default(0),
  rejectedClaims: integer("rejected_claims").notNull().default(0),
  insufficientDataClaims: integer("insufficient_data_claims").notNull().default(0),
  
  // Gap Report (what was missing)
  missingFactTypes: text("missing_fact_types").array(), // Types of facts that were needed but missing
  gapReport: jsonb("gap_report"), // Structured report of data gaps
  
  // Agents Involved
  agentsInvolved: text("agents_involved").array(), // Which agents participated
  generatorModel: varchar("generator_model", { length: 100 }), // Primary generation model
  validatorModel: varchar("validator_model", { length: 100 }), // Validation model
  
  // Safety Metrics
  safetyScore: integer("safety_score").notNull().default(100), // 0-100, higher is safer
  abortTriggered: integer("abort_triggered").notNull().default(0), // Boolean: was abort triggered
  abortReason: text("abort_reason"), // Why generation was aborted
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("content_audit_trails_public_id_idx").on(table.publicId),
  contentTypeIdIdx: index("content_audit_trails_content_type_id_idx").on(table.contentType, table.contentId),
  teamIdIdx: index("content_audit_trails_team_id_idx").on(table.teamId),
  safetyScoreIdx: index("content_audit_trails_safety_score_idx").on(table.safetyScore),
  createdAtIdx: index("content_audit_trails_created_at_idx").on(table.createdAt),
}));

// Agent Execution Manifests - Tracks allowed operations per agent call
export const agentExecutionManifests = pgTable("agent_execution_manifests", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: 'cascade' }),
  
  // Manifest Identity
  agentName: varchar("agent_name", { length: 100 }).notNull(),
  contentType: varchar("content_type", { length: 50 }).notNull(),
  
  // Operation Constraints
  allowedOperations: text("allowed_operations").array().notNull(), // transcoding, stylization, condensation, etc.
  forbiddenOperations: text("forbidden_operations").array().notNull(), // assume, infer_missing_facts, browse
  
  // Input Contract
  confidenceFloor: integer("confidence_floor").notNull().default(70), // Min confidence threshold
  maxFactsPerClaim: integer("max_facts_per_claim").notNull().default(5),
  requireEvidenceBinding: integer("require_evidence_binding").notNull().default(1), // Boolean
  
  // Execution State
  executionId: uuid("execution_id"), // Unique ID for this execution
  status: varchar("status", { length: 30 }).notNull().default("pending"), // pending, executing, completed, aborted
  
  // Audit
  violationsDetected: integer("violations_detected").notNull().default(0),
  violationDetails: jsonb("violation_details"),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  publicIdIdx: index("agent_execution_manifests_public_id_idx").on(table.publicId),
  teamIdIdx: index("agent_execution_manifests_team_id_idx").on(table.teamId),
  executionIdIdx: index("agent_execution_manifests_execution_id_idx").on(table.executionId),
  statusIdx: index("agent_execution_manifests_status_idx").on(table.status),
}));

// Insert schemas for anti-hallucination system
export const insertFactSchema = createInsertSchema(facts).omit({
  id: true,
  publicId: true,
  version: true,
  previousVersionId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFactVersionSchema = createInsertSchema(factVersions).omit({
  id: true,
  createdAt: true,
});

export const insertFactClaimSchema = createInsertSchema(factClaims).omit({
  id: true,
  publicId: true,
  createdAt: true,
});

export const insertContentAuditTrailSchema = createInsertSchema(contentAuditTrails).omit({
  id: true,
  publicId: true,
  createdAt: true,
});

export const insertAgentExecutionManifestSchema = createInsertSchema(agentExecutionManifests).omit({
  id: true,
  publicId: true,
  createdAt: true,
  completedAt: true,
});

// Type exports for anti-hallucination system
export type Fact = typeof facts.$inferSelect;
export type InsertFact = z.infer<typeof insertFactSchema>;
export type FactVersion = typeof factVersions.$inferSelect;
export type InsertFactVersion = z.infer<typeof insertFactVersionSchema>;
export type FactClaim = typeof factClaims.$inferSelect;
export type InsertFactClaim = z.infer<typeof insertFactClaimSchema>;
export type ContentAuditTrail = typeof contentAuditTrails.$inferSelect;
export type InsertContentAuditTrail = z.infer<typeof insertContentAuditTrailSchema>;
export type AgentExecutionManifest = typeof agentExecutionManifests.$inferSelect;
export type InsertAgentExecutionManifest = z.infer<typeof insertAgentExecutionManifestSchema>;

// ============================================================================
// RELATIONS
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  jobBatches: many(jobBatches),
  sessions: many(sessions),
  activityLogs: many(activityLogs),
  totpSecret: many(totpSecrets),
  emailCodes: many(emailVerificationCodes),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}));

export const totpSecretsRelations = relations(totpSecrets, ({ one }) => ({
  user: one(users, {
    fields: [totpSecrets.userId],
    references: [users.id],
  }),
}));

export const emailVerificationCodesRelations = relations(emailVerificationCodes, ({ one }) => ({
  user: one(users, {
    fields: [emailVerificationCodes.userId],
    references: [users.id],
  }),
}));

export const jobBatchesRelations = relations(jobBatches, ({ one, many }) => ({
  user: one(users, {
    fields: [jobBatches.userId],
    references: [users.id],
  }),
  locale: one(locales, {
    fields: [jobBatches.localeId],
    references: [locales.id],
  }),
  articles: many(articles),
  seoCache: one(batchSeoCache, {
    fields: [jobBatches.id],
    references: [batchSeoCache.batchId],
  }),
}));

export const batchSeoCacheRelations = relations(batchSeoCache, ({ one }) => ({
  batch: one(jobBatches, {
    fields: [batchSeoCache.batchId],
    references: [jobBatches.id],
  }),
}));

export const articlesRelations = relations(articles, ({ one, many }) => ({
  batch: one(jobBatches, {
    fields: [articles.batchId],
    references: [jobBatches.id],
  }),
  locale: one(locales, {
    fields: [articles.localeId],
    references: [locales.id],
  }),
  assets: many(articleAssets),
  seoLogs: many(seoLogs),
  socialPosts: many(socialPosts),
  versions: many(articleVersions),
}));

export const articleAssetsRelations = relations(articleAssets, ({ one }) => ({
  article: one(articles, {
    fields: [articleAssets.articleId],
    references: [articles.id],
  }),
}));

export const localesRelations = relations(locales, ({ many }) => ({
  jobBatches: many(jobBatches),
  articles: many(articles),
}));

export const seoLogsRelations = relations(seoLogs, ({ one }) => ({
  article: one(articles, {
    fields: [seoLogs.articleId],
    references: [articles.id],
  }),
}));

export const socialPostsRelations = relations(socialPosts, ({ one, many }) => ({
  user: one(users, {
    fields: [socialPosts.userId],
    references: [users.id],
  }),
  article: one(articles, {
    fields: [socialPosts.articleId],
    references: [articles.id],
  }),
  variants: many(socialPostVariants),
  assets: many(socialPostAssets),
  jobs: many(socialPostJobs),
  logs: many(socialPostLogs),
}));

export const socialPostVariantsRelations = relations(socialPostVariants, ({ one, many }) => ({
  socialPost: one(socialPosts, {
    fields: [socialPostVariants.socialPostId],
    references: [socialPosts.id],
  }),
  assets: many(socialPostAssets),
}));

export const socialPostAssetsRelations = relations(socialPostAssets, ({ one }) => ({
  socialPost: one(socialPosts, {
    fields: [socialPostAssets.socialPostId],
    references: [socialPosts.id],
  }),
  variant: one(socialPostVariants, {
    fields: [socialPostAssets.variantId],
    references: [socialPostVariants.id],
  }),
}));

export const socialPostJobsRelations = relations(socialPostJobs, ({ one }) => ({
  socialPost: one(socialPosts, {
    fields: [socialPostJobs.socialPostId],
    references: [socialPosts.id],
  }),
}));

export const socialPostLogsRelations = relations(socialPostLogs, ({ one }) => ({
  socialPost: one(socialPosts, {
    fields: [socialPostLogs.socialPostId],
    references: [socialPosts.id],
  }),
}));

export const errorLogsRelations = relations(errorLogs, ({ one }) => ({
  batch: one(jobBatches, {
    fields: [errorLogs.batchId],
    references: [jobBatches.id],
  }),
  article: one(articles, {
    fields: [errorLogs.articleId],
    references: [articles.id],
  }),
}));

export const adminActionLogsRelations = relations(adminActionLogs, ({ one }) => ({
  user: one(users, {
    fields: [adminActionLogs.userId],
    references: [users.id],
  }),
}));

export const articleVersionsRelations = relations(articleVersions, ({ one }) => ({
  article: one(articles, {
    fields: [articleVersions.articleId],
    references: [articles.id],
  }),
  creator: one(users, {
    fields: [articleVersions.createdBy],
    references: [users.id],
  }),
}));

export const contentClustersRelations = relations(contentClusters, ({ one, many }) => ({
  team: one(teams, {
    fields: [contentClusters.teamId],
    references: [teams.id],
  }),
  locale: one(locales, {
    fields: [contentClusters.localeId],
    references: [locales.id],
  }),
  creator: one(users, {
    fields: [contentClusters.createdBy],
    references: [users.id],
  }),
  coverageNodes: many(coverageNodes),
}));

export const coverageNodesRelations = relations(coverageNodes, ({ one }) => ({
  cluster: one(contentClusters, {
    fields: [coverageNodes.clusterId],
    references: [contentClusters.id],
  }),
  article: one(articles, {
    fields: [coverageNodes.articleId],
    references: [articles.id],
  }),
}));

// ============================================================================
// INSERT SCHEMAS & TYPES
// ============================================================================

export const insertTeamSchema = createInsertSchema(teams).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({
  id: true,
  joinedAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
}).extend({
  password: z.string().min(12).max(255).optional(), // Password validation (12+ chars, hashed later)
});

export const insertSessionSchema = createInsertSchema(sessions).omit({
  id: true,
  createdAt: true,
  lastActivityAt: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});

export const insertTotpSecretSchema = createInsertSchema(totpSecrets).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});

export const insertEmailVerificationCodeSchema = createInsertSchema(emailVerificationCodes).omit({
  id: true,
  createdAt: true,
});

export const insertJobBatchSchema = createInsertSchema(jobBatches).omit({
  id: true,
  publicId: true,
  createdAt: true,
  completedAt: true,
  deletedAt: true,
});

export const insertBatchSeoCacheSchema = createInsertSchema(batchSeoCache).omit({
  id: true,
  generatedAt: true,
});

export const insertArticleSchema = createInsertSchema(articles).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export const insertArticleAssetSchema = createInsertSchema(articleAssets).omit({
  id: true,
  publicId: true,
  createdAt: true,
  deletedAt: true,
});

export const insertLocaleSchema = createInsertSchema(locales).omit({
  id: true,
  createdAt: true,
});

export const insertSeoLogSchema = createInsertSchema(seoLogs).omit({
  id: true,
  createdAt: true,
});

export const insertSocialPostSchema = createInsertSchema(socialPosts).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export const insertSocialPostVariantSchema = createInsertSchema(socialPostVariants).omit({
  id: true,
  createdAt: true,
});

export const insertSocialPostAssetSchema = createInsertSchema(socialPostAssets).omit({
  id: true,
  createdAt: true,
});

export const insertSocialPostJobSchema = createInsertSchema(socialPostJobs).omit({
  id: true,
  createdAt: true,
});

export const insertSocialPostLogSchema = createInsertSchema(socialPostLogs).omit({
  id: true,
  createdAt: true,
});

export const insertErrorLogSchema = createInsertSchema(errorLogs).omit({
  id: true,
  createdAt: true,
});

export const insertAdminActionLogSchema = createInsertSchema(adminActionLogs).omit({
  id: true,
  createdAt: true,
});

export const insertArticleVersionSchema = createInsertSchema(articleVersions).omit({
  id: true,
  createdAt: true,
});

// Admin Management Schemas
export const insertUserInviteSchema = createInsertSchema(userInvites).omit({
  id: true,
  createdAt: true,
  acceptedAt: true,
  acceptedBy: true,
});

export const insertLoginHistorySchema = createInsertSchema(loginHistory).omit({
  id: true,
  createdAt: true,
});

export const insertPasswordResetSchema = createInsertSchema(passwordResets).omit({
  id: true,
  createdAt: true,
  usedAt: true,
});

export const insertUserQuotaSchema = createInsertSchema(userQuotas).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSystemMetricSchema = createInsertSchema(systemMetrics).omit({
  id: true,
  recordedAt: true,
});

export const insertMaintenanceFlagSchema = createInsertSchema(maintenanceFlags).omit({
  id: true,
  createdAt: true,
  lastModifiedAt: true,
});

export const insertCleanupJobSchema = createInsertSchema(cleanupJobs).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
});

export const insertCleanupConfigSchema = createInsertSchema(cleanupConfig).omit({
  id: true,
  updatedAt: true,
});

export const insertContentClusterSchema = createInsertSchema(contentClusters).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

export const insertCoverageNodeSchema = createInsertSchema(coverageNodes).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLocalAuthoritySignalSchema = createInsertSchema(localAuthoritySignals).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
  lastUsedAt: true,
});

export const insertVideoIdeaSchema = createInsertSchema(videoIdeas).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
  generatedAt: true,
});

// ============================================================================
// MULTI-CHANNEL PUBLISHING SYSTEM TABLES (January 2026)
// ============================================================================

// Publishing channel types
export const publishingChannelEnum = ['website', 'facebook', 'linkedin', 'tiktok'] as const;
export type PublishingChannel = typeof publishingChannelEnum[number];

// Publishing Connections - registered receiver installations and OAuth connections
export const publishingConnections = pgTable("publishing_connections", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: 'cascade' }),
  
  // Connection Details
  name: varchar("name", { length: 255 }).notNull(), // User-friendly name (e.g., "Main Website", "Company Facebook")
  channel: varchar("channel", { length: 50 }).notNull(), // website, facebook, linkedin, tiktok
  
  // Website Receiver Configuration (for channel = 'website')
  baseUrl: text("base_url"), // https://example.com
  apiKeyHash: text("api_key_hash"), // SHA-256 hash of receiver API key
  encryptedApiKey: text("encrypted_api_key"), // AES-256 encrypted API key for HMAC signing
  
  // Capabilities (what content types this connection accepts)
  capabilities: jsonb("capabilities").$type<{
    articles?: boolean;
    images?: boolean;
    videos?: boolean;
    podcasts?: boolean;
  }>().default({ articles: true, images: true }),
  
  // Health Monitoring
  status: varchar("status", { length: 50 }).notNull().default("pending"), // pending, active, error, disabled
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  lastErrorMessage: text("last_error_message"),
  
  // Soft Delete
  deletedAt: timestamp("deleted_at"),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("publishing_connections_public_id_idx").on(table.publicId),
  teamIdChannelIdx: index("publishing_connections_team_id_channel_idx").on(table.teamId, table.channel),
  statusIdx: index("publishing_connections_status_idx").on(table.status),
}));

// OAuth Credentials - stores access tokens for social platforms
export const oauthCredentials = pgTable("oauth_credentials", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id").notNull().references(() => publishingConnections.id, { onDelete: 'cascade' }),
  
  // OAuth Tokens (encrypted in application layer)
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenType: varchar("token_type", { length: 50 }).default("Bearer"),
  
  // Token Metadata
  scopes: text("scopes"), // Comma-separated list of granted scopes
  expiresAt: timestamp("expires_at"),
  
  // Platform-specific data
  platformUserId: varchar("platform_user_id", { length: 255 }), // User/page ID on the platform
  platformUserName: varchar("platform_user_name", { length: 255 }), // Display name
  platformData: jsonb("platform_data"), // Additional platform-specific info
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  connectionIdIdx: index("oauth_credentials_connection_id_idx").on(table.connectionId),
  expiresAtIdx: index("oauth_credentials_expires_at_idx").on(table.expiresAt),
}));

// Publishing Jobs - queued content delivery tasks
export const publishingJobs = pgTable("publishing_jobs", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: 'cascade' }),
  connectionId: integer("connection_id").notNull().references(() => publishingConnections.id, { onDelete: 'cascade' }),
  
  // Content Reference (one of these will be set)
  articleId: integer("article_id").references(() => articles.id, { onDelete: 'cascade' }),
  socialPostId: integer("social_post_id").references(() => socialPosts.id, { onDelete: 'cascade' }),
  videoIdeaId: integer("video_idea_id").references(() => videoIdeas.id, { onDelete: 'cascade' }),
  
  // Content Type
  contentType: varchar("content_type", { length: 50 }).notNull(), // article, social_post, video, podcast
  
  // Job Status
  status: varchar("status", { length: 50 }).notNull().default("pending"), // pending, queued, processing, delivered, failed, cancelled
  pgBossJobId: varchar("pg_boss_job_id", { length: 255 }), // Reference to pg-boss job
  
  // Retry Logic
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lastAttemptAt: timestamp("last_attempt_at"),
  nextRetryAt: timestamp("next_retry_at"),
  
  // Error Handling
  lastError: text("last_error"),
  errorDetails: jsonb("error_details"),
  
  // Result Data
  publishedUrl: text("published_url"), // URL on the target platform
  publishedAt: timestamp("published_at"),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("publishing_jobs_public_id_idx").on(table.publicId),
  teamIdStatusIdx: index("publishing_jobs_team_id_status_idx").on(table.teamId, table.status),
  connectionIdIdx: index("publishing_jobs_connection_id_idx").on(table.connectionId),
  articleIdIdx: index("publishing_jobs_article_id_idx").on(table.articleId),
  statusIdx: index("publishing_jobs_status_idx").on(table.status),
}));

// Publishing Callbacks - delivery confirmation logs from receivers
export const publishingCallbacks = pgTable("publishing_callbacks", {
  id: serial("id").primaryKey(),
  publishingJobId: integer("publishing_job_id").notNull().references(() => publishingJobs.id, { onDelete: 'cascade' }),
  
  // Callback Status
  status: varchar("status", { length: 50 }).notNull(), // success, failure, partial, retryable
  
  // Response Data
  payload: jsonb("payload").$type<{
    pageUrl?: string;
    slug?: string;
    mediaUrls?: Record<string, string>;
    error?: string;
    errorCode?: string;
  }>(),
  
  // Metadata
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  responseTimeMs: integer("response_time_ms"),
  
  // Source Verification
  signature: varchar("signature", { length: 255 }), // HMAC signature for verification
  ipAddress: varchar("ip_address", { length: 255 }),
}, (table) => ({
  publishingJobIdIdx: index("publishing_callbacks_job_id_idx").on(table.publishingJobId),
  statusIdx: index("publishing_callbacks_status_idx").on(table.status),
  receivedAtIdx: index("publishing_callbacks_received_at_idx").on(table.receivedAt),
}));

// ============================================================================
// CONTENT SCHEDULING SYSTEM - Autonomous generation while you sleep
// ============================================================================

// Content Schedules - automated content generation schedules
export const contentSchedules = pgTable("content_schedules", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: 'cascade' }),
  createdBy: integer("created_by").notNull().references(() => users.id),
  
  // Schedule Identity
  name: varchar("name", { length: 255 }).notNull(), // "Daily Blog Posts", "Weekly Newsletter"
  
  // Content Configuration
  coreTopic: text("core_topic").notNull(), // Topic for article generation
  targetUrl: text("target_url").notNull(), // Base URL for content
  businessName: varchar("business_name", { length: 255 }).notNull(),
  businessAddress: text("business_address"),
  businessPhone: varchar("business_phone", { length: 50 }),
  companyLogoUrl: text("company_logo_url"),
  
  // Generation Settings
  articlesPerRun: integer("articles_per_run").notNull().default(5), // How many articles each run
  tone: varchar("tone", { length: 50 }).notNull().default("professional"),
  wordCountMin: integer("word_count_min").notNull().default(800),
  wordCountMax: integer("word_count_max").notNull().default(2000),
  geographicFocus: text("geographic_focus"),
  audience: text("audience"),
  
  // Schedule Timing (cron expression)
  cronExpression: varchar("cron_expression", { length: 100 }).notNull(), // "0 2 * * *" = 2am daily
  timezone: varchar("timezone", { length: 50 }).notNull().default("UTC"),
  
  // Auto-Publish Configuration
  autoPublishEnabled: integer("auto_publish_enabled").notNull().default(1),
  autoPublishConnectionIds: jsonb("auto_publish_connection_ids").$type<number[]>(),
  
  // Status & Tracking
  status: varchar("status", { length: 50 }).notNull().default("active"), // active, paused, disabled
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  totalRuns: integer("total_runs").notNull().default(0),
  totalArticlesGenerated: integer("total_articles_generated").notNull().default(0),
  
  // Soft Delete
  deletedAt: timestamp("deleted_at"),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  publicIdIdx: index("content_schedules_public_id_idx").on(table.publicId),
  teamIdIdx: index("content_schedules_team_id_idx").on(table.teamId),
  statusIdx: index("content_schedules_status_idx").on(table.status),
  nextRunAtIdx: index("content_schedules_next_run_at_idx").on(table.nextRunAt),
}));

// Schedule Run History - logs of each scheduled execution
export const scheduleRuns = pgTable("schedule_runs", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull().references(() => contentSchedules.id, { onDelete: 'cascade' }),
  
  // Run Details
  status: varchar("status", { length: 50 }).notNull(), // started, completed, failed, partial
  batchId: integer("batch_id").references(() => jobBatches.id),
  
  // Results
  articlesRequested: integer("articles_requested").notNull().default(0),
  articlesGenerated: integer("articles_generated").notNull().default(0),
  articlesPublished: integer("articles_published").notNull().default(0),
  
  // Error Tracking
  error: text("error"),
  
  // Timing
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  scheduleIdIdx: index("schedule_runs_schedule_id_idx").on(table.scheduleId),
  statusIdx: index("schedule_runs_status_idx").on(table.status),
  startedAtIdx: index("schedule_runs_started_at_idx").on(table.startedAt),
}));

// Insert Schemas for Scheduling Tables
export const insertContentScheduleSchema = createInsertSchema(contentSchedules).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
  lastRunAt: true,
  nextRunAt: true,
  totalRuns: true,
  totalArticlesGenerated: true,
  deletedAt: true,
});

export const insertScheduleRunSchema = createInsertSchema(scheduleRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

// ============================================================================
// NOTIFICATION SYSTEM - Real-time alerts for job completion/failure
// ============================================================================

export const notificationTypeEnum = ['success', 'error', 'warning', 'info'] as const;
export const notificationCategoryEnum = ['video', 'article', 'social_post', 'batch', 'system'] as const;

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  publicId: uuid("public_id").notNull().unique().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: 'cascade' }),
  teamId: integer("team_id").references(() => teams.id, { onDelete: 'cascade' }),
  type: varchar("type", { length: 20 }).notNull().default("info"), // success, error, warning, info
  category: varchar("category", { length: 50 }).notNull(), // video, article, social_post, batch, system
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  entityId: integer("entity_id"), // Optional: ID of related entity (video, article, etc.)
  entityType: varchar("entity_type", { length: 50 }), // video_idea, article, social_post, batch
  actionUrl: varchar("action_url", { length: 500 }), // Optional: URL to navigate to
  read: integer("read").notNull().default(0), // 0 = unread, 1 = read
  dismissed: integer("dismissed").notNull().default(0), // 0 = not dismissed, 1 = dismissed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  readAt: timestamp("read_at"),
}, (table) => ({
  userIdIdx: index("notifications_user_id_idx").on(table.userId),
  teamIdIdx: index("notifications_team_id_idx").on(table.teamId),
  typeIdx: index("notifications_type_idx").on(table.type),
  categoryIdx: index("notifications_category_idx").on(table.category),
  readIdx: index("notifications_read_idx").on(table.read),
  createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
}));

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  publicId: true,
  createdAt: true,
  readAt: true,
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

// Insert Schemas for Publishing Tables
export const insertPublishingConnectionSchema = createInsertSchema(publishingConnections).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
  lastHeartbeatAt: true,
  deletedAt: true,
});

export const insertOauthCredentialSchema = createInsertSchema(oauthCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPublishingJobSchema = createInsertSchema(publishingJobs).omit({
  id: true,
  publicId: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
});

export const insertPublishingCallbackSchema = createInsertSchema(publishingCallbacks).omit({
  id: true,
  receivedAt: true,
});

// TypeScript types
export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;

export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;

export type TotpSecret = typeof totpSecrets.$inferSelect;
export type InsertTotpSecret = z.infer<typeof insertTotpSecretSchema>;

export type EmailVerificationCode = typeof emailVerificationCodes.$inferSelect;
export type InsertEmailVerificationCode = z.infer<typeof insertEmailVerificationCodeSchema>;

export type JobBatch = typeof jobBatches.$inferSelect;
export type InsertJobBatch = z.infer<typeof insertJobBatchSchema>;

export type BatchSeoCache = typeof batchSeoCache.$inferSelect;
export type InsertBatchSeoCache = z.infer<typeof insertBatchSeoCacheSchema>;

export type Article = typeof articles.$inferSelect;
export type InsertArticle = z.infer<typeof insertArticleSchema>;

export type ArticleAsset = typeof articleAssets.$inferSelect;
export type InsertArticleAsset = z.infer<typeof insertArticleAssetSchema>;

export type Locale = typeof locales.$inferSelect;
export type InsertLocale = z.infer<typeof insertLocaleSchema>;

export type SeoLog = typeof seoLogs.$inferSelect;
export type InsertSeoLog = z.infer<typeof insertSeoLogSchema>;

export type SocialPost = typeof socialPosts.$inferSelect;
export type InsertSocialPost = z.infer<typeof insertSocialPostSchema>;

export type SocialPostVariant = typeof socialPostVariants.$inferSelect;
export type InsertSocialPostVariant = z.infer<typeof insertSocialPostVariantSchema>;

export type SocialPostAsset = typeof socialPostAssets.$inferSelect;
export type InsertSocialPostAsset = z.infer<typeof insertSocialPostAssetSchema>;

export type SocialPostJob = typeof socialPostJobs.$inferSelect;
export type InsertSocialPostJob = z.infer<typeof insertSocialPostJobSchema>;

export type SocialPostLog = typeof socialPostLogs.$inferSelect;
export type InsertSocialPostLog = z.infer<typeof insertSocialPostLogSchema>;

export type ErrorLog = typeof errorLogs.$inferSelect;
export type InsertErrorLog = z.infer<typeof insertErrorLogSchema>;

export type AdminActionLog = typeof adminActionLogs.$inferSelect;
export type InsertAdminActionLog = z.infer<typeof insertAdminActionLogSchema>;

export type ArticleVersion = typeof articleVersions.$inferSelect;
export type InsertArticleVersion = z.infer<typeof insertArticleVersionSchema>;

// Admin Management Types
export type UserInvite = typeof userInvites.$inferSelect;
export type InsertUserInvite = z.infer<typeof insertUserInviteSchema>;

export type LoginHistory = typeof loginHistory.$inferSelect;
export type InsertLoginHistory = z.infer<typeof insertLoginHistorySchema>;

export type PasswordReset = typeof passwordResets.$inferSelect;
export type InsertPasswordReset = z.infer<typeof insertPasswordResetSchema>;

export type UserQuota = typeof userQuotas.$inferSelect;
export type InsertUserQuota = z.infer<typeof insertUserQuotaSchema>;

export type SystemMetric = typeof systemMetrics.$inferSelect;
export type InsertSystemMetric = z.infer<typeof insertSystemMetricSchema>;

export type MaintenanceFlag = typeof maintenanceFlags.$inferSelect;
export type InsertMaintenanceFlag = z.infer<typeof insertMaintenanceFlagSchema>;

export type CleanupJob = typeof cleanupJobs.$inferSelect;
export type InsertCleanupJob = z.infer<typeof insertCleanupJobSchema>;

export type CleanupConfig = typeof cleanupConfig.$inferSelect;
export type InsertCleanupConfig = z.infer<typeof insertCleanupConfigSchema>;

// Content Cluster Types
export type ContentCluster = typeof contentClusters.$inferSelect;
export type InsertContentCluster = z.infer<typeof insertContentClusterSchema>;

export type CoverageNode = typeof coverageNodes.$inferSelect;
export type InsertCoverageNode = z.infer<typeof insertCoverageNodeSchema>;

export type LocalAuthoritySignal = typeof localAuthoritySignals.$inferSelect;
export type InsertLocalAuthoritySignal = z.infer<typeof insertLocalAuthoritySignalSchema>;

export type VideoIdea = typeof videoIdeas.$inferSelect;
export type InsertVideoIdea = z.infer<typeof insertVideoIdeaSchema>;

// Publishing System Types
export type PublishingConnection = typeof publishingConnections.$inferSelect;
export type InsertPublishingConnection = z.infer<typeof insertPublishingConnectionSchema>;

export type OauthCredential = typeof oauthCredentials.$inferSelect;
export type InsertOauthCredential = z.infer<typeof insertOauthCredentialSchema>;

export type PublishingJob = typeof publishingJobs.$inferSelect;
export type InsertPublishingJob = z.infer<typeof insertPublishingJobSchema>;

export type PublishingCallback = typeof publishingCallbacks.$inferSelect;
export type InsertPublishingCallback = z.infer<typeof insertPublishingCallbackSchema>;

// Content Scheduling Types
export type ContentSchedule = typeof contentSchedules.$inferSelect;
export type InsertContentSchedule = z.infer<typeof insertContentScheduleSchema>;

export type ScheduleRun = typeof scheduleRuns.$inferSelect;
export type InsertScheduleRun = z.infer<typeof insertScheduleRunSchema>;

// Learning System Types
export type LearningAgent = typeof learningAgents.$inferSelect;
export type InsertLearningAgent = z.infer<typeof insertLearningAgentSchema>;

export type LearningPattern = typeof learningPatterns.$inferSelect;
export type InsertLearningPattern = z.infer<typeof insertLearningPatternSchema>;

export type ContentPerformanceMetric = typeof contentPerformanceMetrics.$inferSelect;
export type InsertContentPerformanceMetric = z.infer<typeof insertContentPerformanceMetricSchema>;

export type AgentOptimizationLog = typeof agentOptimizationLogs.$inferSelect;
export type InsertAgentOptimizationLog = z.infer<typeof insertAgentOptimizationLogSchema>;

// Extended types for API responses
export type ArticleWithAssets = Article & {
  assets: ArticleAsset[];
};

export type ArticleWithAll = Article & {
  assets: ArticleAsset[];
};

export type JobBatchWithArticles = JobBatch & {
  articles: Article[];
};

// ============================================================================
// API REQUEST/RESPONSE SCHEMAS
// ============================================================================
// SITE MAP / CRAWL SYSTEM - Contextual Hyperlinking
// ============================================================================

export const sitePages = pgTable("site_pages", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull(),
  domain: varchar("domain", { length: 500 }).notNull(),
  url: text("url").notNull(),
  path: text("path").notNull(),
  title: varchar("title", { length: 500 }),
  metaDescription: text("meta_description"),
  headings: jsonb("headings").$type<string[]>(),
  contentSummary: text("content_summary"),
  topics: jsonb("topics").$type<string[]>(),
  pageType: varchar("page_type", { length: 50 }),
  wordCount: integer("word_count"),
  lastCrawledAt: timestamp("last_crawled_at").defaultNow(),
  isActive: integer("is_active").default(1),
  crawlJobId: integer("crawl_job_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const siteCrawlJobs = pgTable("site_crawl_jobs", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull(),
  userId: integer("user_id").notNull(),
  domain: varchar("domain", { length: 500 }).notNull(),
  baseUrl: text("base_url").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("PENDING"),
  maxPages: integer("max_pages").default(50),
  maxDepth: integer("max_depth").default(3),
  pagesFound: integer("pages_found").default(0),
  pagesIndexed: integer("pages_indexed").default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type SitePage = typeof sitePages.$inferSelect;
export type SiteCrawlJob = typeof siteCrawlJobs.$inferSelect;

// ============================================================================
// AI LEARNING LEDGER — Guardian Agent Failure Telemetry
// ============================================================================
// Tracks every quality gate failure caught by the Guardian Agent.
// Used to inject "hard warnings" into future generation prompts so the
// AI learns from its recurring mistakes (In-Context Learning loop).

export const aiLearningLedger = pgTable("ai_learning_ledger", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "cascade" }),
  contentType: varchar("content_type", { length: 50 }).notNull().default("article"),
  errorType: varchar("error_type", { length: 100 }).notNull(),
  count: integer("count").notNull().default(1),
  lastOccurrence: timestamp("last_occurrence").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  teamContentTypeIdx: index("ledger_team_content_type_idx").on(table.teamId, table.contentType),
  errorTypeIdx: index("ledger_error_type_idx").on(table.errorType),
  lastOccurrenceIdx: index("ledger_last_occurrence_idx").on(table.lastOccurrence),
}));

export type AiLearningLedger = typeof aiLearningLedger.$inferSelect;
export type InsertAiLearningLedger = typeof aiLearningLedger.$inferInsert;

// ============================================================================
// CONTENT REVIEWS — one row per reviewed piece, written by ContentReviewService
// ============================================================================
export const contentReviews = pgTable("content_reviews", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  contentType: varchar("content_type", { length: 50 }).notNull(),
  articleId: integer("article_id"),
  socialPostId: integer("social_post_id"),
  videoIdeaId: integer("video_idea_id"),
  dimensionScoresJson: jsonb("dimension_scores_json").notNull().default({}),
  defectsJson: jsonb("defects_json").notNull().default([]),
  passed: integer("passed").notNull().default(0),
  usedJudge: integer("used_judge").notNull().default(0),
  reviewedAt: timestamp("reviewed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  teamTypeIdx: index("content_reviews_team_type_idx").on(t.teamId, t.contentType),
  articleIdx: index("content_reviews_article_idx").on(t.articleId),
  reviewedAtIdx: index("content_reviews_reviewed_at_idx").on(t.reviewedAt),
}));

export type ContentReview = typeof contentReviews.$inferSelect;
export type InsertContentReview = typeof contentReviews.$inferInsert;

// ============================================================================
// PATTERN DIMENSION STATS — per-(patternId, dimension) Wilson score ledger
// ============================================================================
export const patternDimensionStats = pgTable("pattern_dimension_stats", {
  id: serial("id").primaryKey(),
  patternId: integer("pattern_id").notNull().references(() => learningPatterns.id, { onDelete: "cascade" }),
  dimension: varchar("dimension", { length: 50 }).notNull(),
  successes: integer("successes").notNull().default(0),
  trials: integer("trials").notNull().default(0),
  wilsonScore: integer("wilson_score").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  patternDimUnique: uniqueIndex("pattern_dimension_unique").on(t.patternId, t.dimension),
  dimIdx: index("pattern_dimension_dim_idx").on(t.dimension),
  wilsonIdx: index("pattern_dimension_wilson_idx").on(t.wilsonScore),
}));

export type PatternDimensionStat = typeof patternDimensionStats.$inferSelect;
export type InsertPatternDimensionStat = typeof patternDimensionStats.$inferInsert;

// ============================================================================
// COST TELEMETRY — actual AI API usage and cost per operation
// ============================================================================
export const costTelemetry = pgTable("cost_telemetry", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id"),
  userId: integer("user_id"),
  batchId: integer("batch_id"),
  articleId: integer("article_id"),
  jobId: varchar("job_id", { length: 100 }),
  operationType: varchar("operation_type", { length: 50 }).notNull(),
  provider: varchar("provider", { length: 20 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  unitType: varchar("unit_type", { length: 20 }).notNull().default("tokens"),
  unitCount: integer("unit_count"),
  costMicrousd: integer("cost_microusd").notNull().default(0),
  success: integer("success").notNull().default(1),
  latencyMs: integer("latency_ms"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  teamCreatedIdx: index("cost_telemetry_team_created_idx").on(t.teamId, t.createdAt),
  opTypeIdx: index("cost_telemetry_op_type_idx").on(t.operationType, t.createdAt),
  providerModelIdx: index("cost_telemetry_provider_model_idx").on(t.provider, t.model),
  batchIdx: index("cost_telemetry_batch_idx").on(t.batchId),
  articleIdx: index("cost_telemetry_article_idx").on(t.articleId),
}));

export const insertCostTelemetrySchema = createInsertSchema(costTelemetry).omit({ id: true, createdAt: true });
export type InsertCostTelemetry = z.infer<typeof insertCostTelemetrySchema>;
export type CostTelemetry = typeof costTelemetry.$inferSelect;

// ============================================================================
// CREDIT SYSTEM
// ============================================================================

export const creditBalances = pgTable("credit_balances", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }).unique(),
  balance: integer("balance").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  teamIdx: uniqueIndex("credit_balances_team_idx").on(t.teamId),
}));

export type CreditBalance = typeof creditBalances.$inferSelect;

export const creditLedger = pgTable("credit_ledger", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id),
  adminUserId: integer("admin_user_id").references(() => users.id),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  eventType: varchar("event_type", { length: 30 }).notNull(),
  productType: varchar("product_type", { length: 30 }),
  sourceType: varchar("source_type", { length: 30 }),
  sourceId: integer("source_id"),
  jobId: varchar("job_id", { length: 255 }),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).unique(),
  reason: text("reason"),
  reversedAt: timestamp("reversed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  teamCreatedIdx: index("credit_ledger_team_created_idx").on(t.teamId, t.createdAt),
  productIdx: index("credit_ledger_product_idx").on(t.productType, t.createdAt),
  idempotencyIdx: uniqueIndex("credit_ledger_idempotency_idx").on(t.idempotencyKey),
}));

export type CreditLedger = typeof creditLedger.$inferSelect;

// ============================================================================
// BILLING EVENTS — Stripe webhook idempotency log
// ============================================================================

export const billingEvents = pgTable("billing_events", {
  id: serial("id").primaryKey(),
  stripeEventId: varchar("stripe_event_id", { length: 255 }).notNull().unique(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
  payload: jsonb("payload"),
}, (t) => ({
  stripeEventIdx: uniqueIndex("billing_events_stripe_event_idx").on(t.stripeEventId),
  teamIdx: index("billing_events_team_idx").on(t.teamId),
}));

export type BillingEvent = typeof billingEvents.$inferSelect;

// ============================================================================
// RATE LIMITING (DB-backed, survives restarts)
// ============================================================================
export const rateLimitWindows = pgTable("rate_limit_windows", {
  keyHash: varchar("key_hash", { length: 64 }).primaryKey(),
  count: integer("count").notNull().default(1),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
}, (table) => ({
  resetAtIdx: index("rate_limit_windows_reset_at_idx").on(table.resetAt),
}));

export type RateLimitWindow = typeof rateLimitWindows.$inferSelect;

// ============================================================================

export const titlePoolRequestSchema = z.object({
  coreTopic: z.string().min(1, "Core topic is required"),
  numTitles: z.number().int().min(10).max(100).default(50),
  targetAudience: z.string().optional(),
  geographic: z.string().optional(),
});

export const batchSubmitSchema = z.object({
  userId: z.number().int(),
  coreTopic: z.string().min(1),
  targetUrl: z.string().url("Must be a valid URL"),
  selectedTitles: z.array(z.string()).min(1).max(50),
  wordCount: z.number().int().min(800).max(2000).default(1200),
  targetAudience: z.string().optional(),
  geographic: z.string().optional(),
});

export type TitlePoolRequest = z.infer<typeof titlePoolRequestSchema>;
export type BatchSubmitRequest = z.infer<typeof batchSubmitSchema>;
