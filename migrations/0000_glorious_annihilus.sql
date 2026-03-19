CREATE TABLE "admin_action_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"action" varchar(100) NOT NULL,
	"target_type" varchar(50),
	"target_id" integer,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"asset_type" varchar(20) DEFAULT 'image' NOT NULL,
	"image_prompt_used" text,
	"storage_url" text NOT NULL,
	"alt_text" varchar(255),
	"file_format" varchar(10) DEFAULT 'webp' NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"run_id" varchar(36) NOT NULL,
	"run_type" varchar(50) DEFAULT 'generation' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"cached_gemini_output" jsonb,
	"cached_chatgpt_output" jsonb,
	"cached_gpt4_output" jsonb
);
--> statement-breakpoint
CREATE TABLE "article_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"final_html_content" text NOT NULL,
	"seo_title" varchar(60),
	"meta_description" varchar(160),
	"keywords_json" jsonb,
	"hashtags_json" jsonb,
	"geo_accuracy_score" integer,
	"word_count" integer,
	"change_reason" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"locale_id" integer,
	"article_status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"chosen_title" varchar(255) NOT NULL,
	"final_html_content" text,
	"hero_image_url" text,
	"seo_title" varchar(60),
	"meta_description" varchar(160),
	"slug" varchar(255),
	"keywords_json" jsonb,
	"hashtags_json" jsonb,
	"faq_json" jsonb,
	"word_count" integer,
	"geo_accuracy_score" integer,
	"internal_link_suggestions" jsonb,
	"seo_score" integer,
	"hyperlinked_keywords_json" jsonb,
	"meta_enrichment" jsonb,
	"podcast_url" text,
	"podcast_duration" integer,
	"podcast_generated_at" timestamp,
	"podcast_status" varchar(50) DEFAULT 'none',
	"podcast_script_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "batch_seo_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"location_analysis_json" jsonb,
	"location_keywords_json" jsonb,
	"competitor_insights_json" jsonb,
	"competitor_keywords_json" jsonb,
	"semantic_clusters_json" jsonb,
	"topical_authority_json" jsonb,
	"cache_version" varchar(10) DEFAULT '1.0' NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "batch_seo_cache_batch_id_unique" UNIQUE("batch_id")
);
--> statement-breakpoint
CREATE TABLE "error_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer,
	"article_id" integer,
	"error_type" varchar(50) NOT NULL,
	"error_message" text NOT NULL,
	"stack_trace" text,
	"severity" varchar(20) DEFAULT 'error' NOT NULL,
	"resolved" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"locale_id" integer,
	"core_topic" varchar(255) NOT NULL,
	"target_url" text NOT NULL,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"num_articles_requested" integer NOT NULL,
	"title_pool_json" jsonb,
	"generation_params" jsonb,
	"business_name" varchar(255),
	"business_address" text,
	"business_phone" varchar(20),
	"company_logo_url" text,
	"competitor_urls_json" jsonb,
	"semantic_cluster_id" integer,
	"serp_feature_target" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer,
	"article_id" integer,
	"event_type" varchar(50) NOT NULL,
	"stage" varchar(50),
	"message" text NOT NULL,
	"payload_json" jsonb,
	"duration_ms" integer,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locales" (
	"id" serial PRIMARY KEY NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"region" varchar(100),
	"city" varchar(100),
	"postal_code" varchar(20),
	"latitude" varchar(20),
	"longitude" varchar(20),
	"place_id" varchar(255),
	"formatted_address" text,
	"language" varchar(10) DEFAULT 'en-US' NOT NULL,
	"timezone" varchar(50),
	"population" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "locales_place_id_unique" UNIQUE("place_id")
);
--> statement-breakpoint
CREATE TABLE "seo_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"token_cost" integer NOT NULL,
	"geo_accuracy_score" integer,
	"schema_validation_fail" integer DEFAULT 0 NOT NULL,
	"rank_tracking_score" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"social_post_id" integer NOT NULL,
	"variant_id" integer,
	"platform" varchar(20) NOT NULL,
	"asset_type" varchar(10) DEFAULT 'image' NOT NULL,
	"prompt_used" text NOT NULL,
	"storage_url" text NOT NULL,
	"alt_text" varchar(255),
	"aspect_ratio" varchar(10) NOT NULL,
	"width" integer,
	"height" integer,
	"file_format" varchar(10) DEFAULT 'webp' NOT NULL,
	"video_duration" integer,
	"video_resolution" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"social_post_id" integer NOT NULL,
	"job_id" varchar(255) NOT NULL,
	"job_type" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "social_post_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "social_post_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"social_post_id" integer NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"stage" varchar(50),
	"message" text NOT NULL,
	"payload_json" jsonb,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"social_post_id" integer NOT NULL,
	"platform" varchar(20) NOT NULL,
	"variant_index" integer DEFAULT 1 NOT NULL,
	"caption" text NOT NULL,
	"character_count" integer NOT NULL,
	"hashtags" text,
	"hashtags_json" jsonb NOT NULL,
	"emojis_json" jsonb,
	"hyperlinks_json" jsonb,
	"character_limit" integer,
	"aspect_ratio" varchar(10),
	"image_url" text,
	"platform_metadata" jsonb,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"article_id" integer,
	"topic" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"location" varchar(255) NOT NULL,
	"prompt" text,
	"tone" varchar(50) DEFAULT 'Professional' NOT NULL,
	"mood" varchar(50),
	"industry" varchar(100),
	"landing_page_url" varchar(500),
	"company_name" varchar(255),
	"company_logo_url" text,
	"platforms_json" jsonb NOT NULL,
	"number_of_posts" integer DEFAULT 3 NOT NULL,
	"include_image" integer DEFAULT 1 NOT NULL,
	"include_video" integer DEFAULT 0 NOT NULL,
	"image_preference" varchar(50),
	"auto_share" integer DEFAULT 0 NOT NULL,
	"user_email" varchar(255),
	"video_url" text,
	"video_status" varchar(20),
	"video_progress" integer DEFAULT 0,
	"video_stage" varchar(50),
	"video_duration" integer DEFAULT 60,
	"video_script_json" jsonb,
	"video_generated_at" timestamp,
	"geo_tags_json" jsonb,
	"seo_keywords_json" jsonb,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"schedule_at" timestamp,
	"job_id" varchar(255),
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'client' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "admin_action_logs" ADD CONSTRAINT "admin_action_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_assets" ADD CONSTRAINT "article_assets_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_runs" ADD CONSTRAINT "article_runs_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_batch_id_job_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."job_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_locale_id_locales_id_fk" FOREIGN KEY ("locale_id") REFERENCES "public"."locales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_seo_cache" ADD CONSTRAINT "batch_seo_cache_batch_id_job_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."job_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_batch_id_job_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."job_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_batches" ADD CONSTRAINT "job_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_batches" ADD CONSTRAINT "job_batches_locale_id_locales_id_fk" FOREIGN KEY ("locale_id") REFERENCES "public"."locales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_batch_id_job_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."job_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_logs" ADD CONSTRAINT "seo_logs_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_assets" ADD CONSTRAINT "social_post_assets_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_assets" ADD CONSTRAINT "social_post_assets_variant_id_social_post_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."social_post_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_jobs" ADD CONSTRAINT "social_post_jobs_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_logs" ADD CONSTRAINT "social_post_logs_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_variants" ADD CONSTRAINT "social_post_variants_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_action_logs_user_id_idx" ON "admin_action_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_action_logs_action_idx" ON "admin_action_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "article_runs_article_id_run_id_unique" ON "article_runs" USING btree ("article_id","run_id");--> statement-breakpoint
CREATE INDEX "article_runs_article_id_idx" ON "article_runs" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "article_runs_run_id_idx" ON "article_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "article_runs_status_idx" ON "article_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "article_versions_article_id_idx" ON "article_versions" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "batch_seo_cache_batch_id_idx" ON "batch_seo_cache" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "error_logs_batch_id_idx" ON "error_logs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "error_logs_article_id_idx" ON "error_logs" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "error_logs_error_type_idx" ON "error_logs" USING btree ("error_type");--> statement-breakpoint
CREATE INDEX "error_logs_resolved_idx" ON "error_logs" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX "job_events_batch_id_idx" ON "job_events" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "job_events_article_id_idx" ON "job_events" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "job_events_created_at_idx" ON "job_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "job_events_event_type_idx" ON "job_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "job_events_severity_idx" ON "job_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "locales_city_region_idx" ON "locales" USING btree ("city","region");--> statement-breakpoint
CREATE INDEX "locales_place_id_idx" ON "locales" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "locales_coordinates_idx" ON "locales" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "seo_logs_article_id_idx" ON "seo_logs" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "social_post_assets_social_post_id_idx" ON "social_post_assets" USING btree ("social_post_id");--> statement-breakpoint
CREATE INDEX "social_post_assets_platform_idx" ON "social_post_assets" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "social_post_assets_asset_type_idx" ON "social_post_assets" USING btree ("asset_type");--> statement-breakpoint
CREATE INDEX "social_post_jobs_social_post_id_idx" ON "social_post_jobs" USING btree ("social_post_id");--> statement-breakpoint
CREATE INDEX "social_post_jobs_job_id_idx" ON "social_post_jobs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "social_post_jobs_status_idx" ON "social_post_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "social_post_logs_social_post_id_idx" ON "social_post_logs" USING btree ("social_post_id");--> statement-breakpoint
CREATE INDEX "social_post_logs_event_type_idx" ON "social_post_logs" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "social_post_logs_severity_idx" ON "social_post_logs" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "social_post_variants_social_post_id_idx" ON "social_post_variants" USING btree ("social_post_id");--> statement-breakpoint
CREATE INDEX "social_post_variants_platform_idx" ON "social_post_variants" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "social_post_variants_status_idx" ON "social_post_variants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "social_posts_user_id_idx" ON "social_posts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "social_posts_status_idx" ON "social_posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "social_posts_schedule_at_idx" ON "social_posts" USING btree ("schedule_at");