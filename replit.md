# ApexContent Engine - Advanced Local SEO Powerhouse

## Overview
ApexContent Engine is a dual-AI SEO content generation platform specializing in scalable, high-quality, and SEO-optimized content, with a primary focus on local SEO. It integrates deep local intelligence (ZIP codes, neighborhoods, regulations, authority entities) and E-E-A-T signals into all generated content. The platform aims to provide a robust solution for businesses needing advanced local SEO content generation, ensuring content is location-based and answer-first optimized for AI citations.

## User Preferences
- **Communication style:** Simple, everyday language
- **Development approach:** Get core working first, then expand features incrementally
- **Lesson learned:** First app failed because it was too ambitious - prioritize working functionality

## System Architecture

### System Design Choices
- **Tech Stack:** Next.js 14 (App Router), TypeScript, React 18, shadcn/ui + Tailwind CSS, PostgreSQL, Drizzle ORM, pg-boss, Gemini 2.5 Pro/Flash, GPT-4/GPT-4o-mini, TanStack Query, React Hook Form with Zod, Replit Object Storage.
- **Database Schema:** Multi-tenant support with tables for users, teams, job batches, articles, and geo-specific features, including UUIDs and soft delete.
- **Multi-Tenant Team Architecture:** Team and team member tables with isolation for content and performance optimizations.
- **UI/UX:** Frontend uses Next.js, shadcn/ui, and Tailwind CSS, featuring real-time monitoring, content export, and media library.
- **Mandatory Location-Based SEO:** All content generation inherently integrates location metadata and deep local intelligence.
- **Brand Lock System:** A three-layer system prevents company name misspellings through AI prompt enforcement, runtime validation, and user regeneration.
- **Batch SEO Caching:** Generates and reuses shared SEO context per batch to reduce API calls.
- **Run ID Tracking & Cache System:** Prevents duplicate jobs and enables intelligent cache reuse for article generation.
- **AI Rate Limiting & Batching:** Manages API concurrency with `p-limit` and exponential backoff.
- **Admin Management System:** Comprehensive admin panel with user invite system, role management, and detailed action logging.
- **Team Isolation & API Security:** Enhanced authentication middleware enforces `teamId` and `requireTeamMember()` on all high-risk routes, with `requireAdmin()` for admin endpoints.
- **Database Cascade Delete Integrity:** Uniform hard delete with proper cascade order for various entities.
- **Comprehensive JSON-LD Schema Generation:** Supports 6 schema.org types with citation optimization, E-E-A-T ratings, and coverage metrics.
- **Content Cluster Architecture:** A `Cluster Service` creates a pillar + spoke structure for topical authority using 8 subtopic categories and 7 coverage pillars, including location parsing.
- **Advanced Local SEO Transformation:** Pipeline enhances E-E-A-T signals, AI citation optimization, and content cluster architecture.
- **Intent Consolidation:** Two-phase Reddit research workflow transforms discussions into structured, AEO-compliant outlines using Gemini for clustering and mapping to coverage pillars.
- **Smart Topic Research:** Automatically researches any topic using Brave Search API before title generation to find local entities, competitor titles, and suggested content angles.
- **Agentic Critique Loop:** AI-powered self-correction phase that reviews generated titles for hallucinations, clichés, forced geo-references, and competitor duplicates, using low-temperature Gemini for precise analysis.
- **Jaccard Uniqueness Scoring:** Mathematical scoring (0-100) compares generated titles against competitor titles using Jaccard similarity.
- **Article Critique & Fact-Checking:** Post-generation quality assurance module with AI cliché removal, promotional language detection, search-augmented fact-checking, E-E-A-T scoring, answer-first validation, and keyword density analysis.
- **Reflexive Article Validation:** Two-pass self-correction system that validates generated content for promotional language violations, section-scoped enforcement, and AI-powered rewrites to de-advertise content.
- **Strict GEO/AEO Formatting Constraints:** AI prompts enforce strict answer-first optimization, explicit author entity integration, and validation of meta titles/descriptions.
- **AI Learning System:** Adaptive content optimization that learns from performance using 5 specialized learning agents, EMA-based learning, pre-prompt optimization, and confidence scoring for patterns.
- **Article Shadow Run Pre-Flight System:** Before each Gemini call, a shadow run reads the last 50 error log entries, classifies them into failure patterns (brand-lock, structured-output, review-readiness, generation-discipline, format-discipline), and injects a mandatory pre-flight prompt section. This teaches the model to avoid repeating previous failures on every article generation. Results are logged as `ARTICLE_PREFLIGHT` events for observability.
- **Psychographic Targeting System:** OCEAN-based content personalization using the Big Five Personality Model, audience personas, adaptive messaging, and behavioral learning. Fully integrated across all content generators (articles, social posts, video scripts, podcasts) - each accepts optional teamId/personaId and injects persona-specific messaging guidelines into AI prompts.
- **Wisdom Pipeline:** 8-step cross-referencing system that forces AI to analyze persona data before generating content: Identity Check, Moral Foundation, Psychological Profile, Pain Point Injection, Motivation Alignment, Objection Pre-Handling, Emotional Anchor, Content Strategy.
- **Content Publishing Pipeline:** Creates publishing jobs, enqueues them in pg-boss, and processes them to deliver to `@apex/receiver`. Supports articles, podcasts, and videos with inline image re-hosting. Auto-publish functionality is included.
- **Global Slug Map Hyperlink System:** A single source of truth for hyperlink injection, building a keyword-to-URL dictionary from crawled site pages or batch context terms. Uses Cheerio DOM for injection.
- **Site Map Crawl & Contextual Hyperlinking:** Crawls client websites to index pages, then matches article topics to relevant pages for multi-URL hyperlinking.
- **Reddit JSON API + Expert Discovery:** Utilizes Reddit JSON API for intent research and Brave Search API for identifying SMEs.
- **GPT-4 Content Audit System:** Retroactive quality analysis tool for existing articles, scoring on AEO/GEO compliance and identifying internal linking opportunities.
- **Complete Media Optimization System:** SEO/GEO-optimized media stack with local asset support for images, videos, and audio, including schema.org markup, location-aware metadata, and accessibility.
- **Anti-Hallucination Framework:** Comprehensive fact-based content generation system that prevents AI hallucination by design through Immutable Fact Store, Evidence Binding, Claim Classification, Confidence Gating, Gap Declaration, Audit Trail, and Team Isolation.
- **Deterministic Humanization (DH) System:** Post-processing pipeline that adds structural entropy to AI content to solve "The Uncanny Valley of Perfection". Integrated across all generators and the Learning System.
- **Comprehensive Error Logging System:** All pipeline failures write to the `error_logs` database table with full context snapshots, visible in the Admin Error Log panel, and trigger Slack webhook alerts.
- **Client-Side Error Boundary with Screenshots:** React `ErrorBoundary` captures screenshots of UI crashes, uploads them to Object Storage, logs them, and sends Slack notifications.
- **Publishing Dashboard:** Admin sidebar link for quick access to publishing settings, connections, jobs, and status.

### 4-Stage Content Pipeline
1.  **Title Pool Generation:** Gemini generates 50 location-optimized SEO titles with answer-first framing.
2.  **Content & Image Generation:** Gemini produces 800-2000 word articles integrating deep local intelligence.
3.  **ChatGPT Review & Enrichment:** GPT-4o-mini performs batched review including SEO analysis, hashtag generation, social snippets, and advanced content validation.
4.  **GPT-4 Enhancement & Intelligent Hyperlinking:** GPT-4 applies two-phase GEO-optimized hyperlinking, integrates images, embeds comprehensive JSON-LD schema, and finalizes with semantic HTML.

### Modules
- **Multi-City Title Generation:** Generates location-specific title pools.
- **Standalone Social Media Module:** Generates platform-optimized business content with mandatory location-based SEO/GEO targeting.
- **AI Podcast Module:** Creates conversational two-voice podcast summaries of articles using AI-powered script generation and OpenAI TTS.
- **60-Second Social Video Module:** Generates landscape marketing videos with an AI-scripted structure, cinematic images, OpenAI TTS, and dynamic captions.
- **Idea to Video System:** Transforms user ideas into 60-second AI videos with Gemini-powered idea expansion, various visual styles and narration tones, and CTA enforcement.
- **Like Video Feature:** Allows users to paste a reference video URL, analyze its visual style, then generate a new video that replicates that style with custom content.

### Job Queue Architecture
- `pg-boss` manages `title-pool`, `batch-generation`, and `article-generation` queues for concurrent processing with dynamic rate limiting, auto-retry, and resume logic.
- **Job Recovery System:** Automatic protection against server restart failures for various content types and batches.
- **Real-Time Notification System:** Database-backed notification system for job completion/failure alerts with team isolation, type categorization, and read/dismiss tracking.

### Multi-Channel Publishing System
- **Content Receiver Package (@apex/receiver v2.0.0):** An npm package for client websites that receives articles, images, videos, and podcasts. Upgraded to "Platinum" architecture: Cheerio-based image hydration rewrites all `<img>` src values in bodyHtml to locally-saved URLs; `upsertArticleByTitle()` writes a unified JSON data record (`data/articles/{slug}.json`) with metadata + hydrated HTML for the CMS card grid and article view; maintains a `data/articles/index.json` master index; and writes a standalone HTML page. Supports base64-encoded images in the payload for zero-hotlink delivery.
- **Channel Adapters Pattern:** Each publishing channel implements `validate()`, `format()`, `publish()`, and `verify()` methods.
- **Database Schema Additions:** Tables for `publishing_connections`, `publishing_jobs`, `publishing_callbacks`, and `oauth_credentials`.
- **API Endpoints:** Dedicated endpoints for receiver-side content/media handling and engine-side connection management, job queuing, callback processing, and OAuth.
- **Media Flow:** Content and media are generated, sent to the client-side receiver, stored locally on the client site, and then the local copy on the ApexContent Engine is deleted.
- **Social Platform Integration:** Supports Facebook (Meta Graph API), LinkedIn (Marketing API), and TikTok (Content Posting API) via OAuth.

### AI Model Configuration
All AI models are configured to **AUTO-UPDATE** to the latest stable versions. This applies to Gemini models (e.g., `gemini-2.5-flash`) and OpenAI models (e.g., `chatgpt-4o-latest`, `gpt-4o-mini`). Specific models can be pinned to dated versions to disable auto-updates. TTS configuration allows for voice selection and emotional steering.

## External Dependencies

-   **Google AI:** Gemini 2.5 Pro, Gemini 2.5 Flash Image, Gemini 2.0 Flash
-   **OpenAI:** GPT-4, GPT-4o-mini, DALL-E 3, OpenAI TTS
-   **Neon Database:** PostgreSQL hosting
-   **pg-boss:** Job queueing system
-   **Replit Object Storage:** Permanent media storage
-   **Brave Search API:** For smart topic research and fact-checking