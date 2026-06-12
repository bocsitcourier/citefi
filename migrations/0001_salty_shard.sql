CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"team_id" integer,
	"action" varchar(100) NOT NULL,
	"resource" varchar(100),
	"resource_id" integer,
	"target_type" varchar(50),
	"target_public_id" varchar(36),
	"ip_address" varchar(255),
	"user_agent" text,
	"details" jsonb,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_execution_manifests" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" integer NOT NULL,
	"agent_name" varchar(100) NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"allowed_operations" text[] NOT NULL,
	"forbidden_operations" text[] NOT NULL,
	"confidence_floor" integer DEFAULT 70 NOT NULL,
	"max_facts_per_claim" integer DEFAULT 5 NOT NULL,
	"require_evidence_binding" integer DEFAULT 1 NOT NULL,
	"execution_id" uuid,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"violations_detected" integer DEFAULT 0 NOT NULL,
	"violation_details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "agent_execution_manifests_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "agent_optimization_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"optimization_type" varchar(50) NOT NULL,
	"description" text,
	"before_metrics_json" jsonb,
	"after_metrics_json" jsonb,
	"changes_applied_json" jsonb,
	"patterns_updated" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_learning_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer,
	"content_type" varchar(50) DEFAULT 'article' NOT NULL,
	"error_type" varchar(100) NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_occurrence" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_personas" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"avatar_url" text,
	"openness" integer DEFAULT 50 NOT NULL,
	"conscientiousness" integer DEFAULT 50 NOT NULL,
	"extraversion" integer DEFAULT 50 NOT NULL,
	"agreeableness" integer DEFAULT 50 NOT NULL,
	"neuroticism" integer DEFAULT 50 NOT NULL,
	"risk_tolerance" integer DEFAULT 50 NOT NULL,
	"decision_style" varchar(50) DEFAULT 'balanced',
	"value_orientation" varchar(50) DEFAULT 'balanced',
	"age_range_min" integer,
	"age_range_max" integer,
	"gender" varchar(50),
	"income_level" varchar(50),
	"education" varchar(100),
	"preferred_content_length" varchar(50) DEFAULT 'medium',
	"preferred_tone" varchar(50) DEFAULT 'professional',
	"preferred_format" varchar(50) DEFAULT 'mixed',
	"engagement_time_preference" varchar(50),
	"topics_of_interest" jsonb,
	"pain_points" jsonb,
	"motivations" jsonb,
	"objections" jsonb,
	"emotional_triggers" jsonb,
	"avoid_phrases" jsonb,
	"preferred_phrases" jsonb,
	"cta_style" varchar(100) DEFAULT 'value-first',
	"total_content_generated" integer DEFAULT 0 NOT NULL,
	"avg_engagement_rate" integer DEFAULT 0 NOT NULL,
	"avg_conversion_rate" integer DEFAULT 0 NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"is_default" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "audience_personas_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "cleanup_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"setting_key" varchar(100) NOT NULL,
	"setting_value" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "cleanup_config_setting_key_unique" UNIQUE("setting_key")
);
--> statement-breakpoint
CREATE TABLE "cleanup_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"items_deleted" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"dry_run" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_audit_trails" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"content_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"facts_used" integer[] NOT NULL,
	"facts_requested" integer NOT NULL,
	"facts_covered" integer NOT NULL,
	"avg_confidence" integer NOT NULL,
	"min_confidence" integer NOT NULL,
	"confidence_threshold" integer NOT NULL,
	"total_claims" integer DEFAULT 0 NOT NULL,
	"approved_claims" integer DEFAULT 0 NOT NULL,
	"rejected_claims" integer DEFAULT 0 NOT NULL,
	"insufficient_data_claims" integer DEFAULT 0 NOT NULL,
	"missing_fact_types" text[],
	"gap_report" jsonb,
	"agents_involved" text[],
	"generator_model" varchar(100),
	"validator_model" varchar(100),
	"safety_score" integer DEFAULT 100 NOT NULL,
	"abort_triggered" integer DEFAULT 0 NOT NULL,
	"abort_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "content_audit_trails_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "content_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" integer,
	"topic_pillar" varchar(255) NOT NULL,
	"location" varchar(255) NOT NULL,
	"locale_id" integer,
	"status" varchar(20) DEFAULT 'planning' NOT NULL,
	"total_nodes_planned" integer DEFAULT 0 NOT NULL,
	"total_nodes_complete" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "content_clusters_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "content_performance_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" integer,
	"content_type" varchar(50) NOT NULL,
	"article_id" integer,
	"social_post_id" integer,
	"video_idea_id" integer,
	"patterns_used_json" jsonb,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"time_on_page" integer DEFAULT 0 NOT NULL,
	"bounce_rate" integer DEFAULT 0 NOT NULL,
	"quality_score" integer DEFAULT 0 NOT NULL,
	"eat_score" integer DEFAULT 0 NOT NULL,
	"readability_score" integer DEFAULT 0 NOT NULL,
	"is_success" integer,
	"success_reason" text,
	"feedback_processed" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "content_performance_metrics_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "content_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"article_id" integer,
	"social_post_id" integer,
	"video_idea_id" integer,
	"dimension_scores_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"defects_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"used_judge" integer DEFAULT 0 NOT NULL,
	"reviewed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"core_topic" text NOT NULL,
	"target_url" text NOT NULL,
	"business_name" varchar(255) NOT NULL,
	"business_address" text,
	"business_phone" varchar(50),
	"company_logo_url" text,
	"articles_per_run" integer DEFAULT 5 NOT NULL,
	"tone" varchar(50) DEFAULT 'professional' NOT NULL,
	"word_count_min" integer DEFAULT 800 NOT NULL,
	"word_count_max" integer DEFAULT 2000 NOT NULL,
	"geographic_focus" text,
	"audience" text,
	"cron_expression" varchar(100) NOT NULL,
	"timezone" varchar(50) DEFAULT 'UTC' NOT NULL,
	"auto_publish_enabled" integer DEFAULT 1 NOT NULL,
	"auto_publish_connection_ids" jsonb,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"total_articles_generated" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "content_schedules_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "coverage_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" integer NOT NULL,
	"subtopic_category" varchar(100) NOT NULL,
	"subtopic_title" varchar(255) NOT NULL,
	"article_id" integer,
	"depth_score" integer DEFAULT 0 NOT NULL,
	"local_signal_strength" integer DEFAULT 0 NOT NULL,
	"eat_score" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coverage_nodes_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "email_verification_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"code" varchar(6) NOT NULL,
	"purpose" varchar(50) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"is_used" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"content_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"sentence_index" integer NOT NULL,
	"claim_text" text NOT NULL,
	"fact_ids" integer[] NOT NULL,
	"claim_class" varchar(50) NOT NULL,
	"confidence" integer NOT NULL,
	"validation_status" varchar(30) NOT NULL,
	"validator_agent" varchar(100),
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fact_claims_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "fact_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"fact_id" integer NOT NULL,
	"version" integer NOT NULL,
	"fact_text" text NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"source_url" text,
	"confidence" integer NOT NULL,
	"changed_by" integer,
	"change_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" integer NOT NULL,
	"fact_text" text NOT NULL,
	"entity_type" varchar(100),
	"entity_name" varchar(255),
	"source_type" varchar(50) NOT NULL,
	"source_url" text,
	"source_excerpt" text,
	"verified_by" varchar(100) NOT NULL,
	"verified_at" timestamp DEFAULT now() NOT NULL,
	"verifier_id" integer,
	"confidence" integer DEFAULT 80 NOT NULL,
	"expires_at" timestamp,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"previous_version_id" integer,
	"tags" text[],
	"category" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "facts_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "learning_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" integer,
	"content_type" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"primary_model" varchar(100) NOT NULL,
	"fallback_model" varchar(100),
	"temperature" integer DEFAULT 70 NOT NULL,
	"learning_rate" integer DEFAULT 10 NOT NULL,
	"min_sample_size" integer DEFAULT 5 NOT NULL,
	"confidence_threshold" integer DEFAULT 60 NOT NULL,
	"total_generations" integer DEFAULT 0 NOT NULL,
	"successful_generations" integer DEFAULT 0 NOT NULL,
	"average_quality_score" integer DEFAULT 0 NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"last_optimized_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learning_agents_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "learning_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" integer NOT NULL,
	"team_id" integer,
	"pattern_type" varchar(100) NOT NULL,
	"pattern_name" varchar(255) NOT NULL,
	"pattern_value" text NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"industry" varchar(100),
	"audience" varchar(255),
	"success_rate" integer DEFAULT 50 NOT NULL,
	"engagement_score" integer DEFAULT 50 NOT NULL,
	"quality_score" integer DEFAULT 50 NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"times_used" integer DEFAULT 0 NOT NULL,
	"times_successful" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learning_patterns_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "local_authority_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"entity_name" varchar(255) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"location" varchar(255) NOT NULL,
	"citation_url" text,
	"citation_text" text,
	"credibility_score" integer DEFAULT 0 NOT NULL,
	"freshness_date" timestamp,
	"is_verified" integer DEFAULT 0 NOT NULL,
	"times_used" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "local_authority_signals_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "login_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"email" varchar(255) NOT NULL,
	"success" integer NOT NULL,
	"failure_reason" varchar(100),
	"ip_address" varchar(255) NOT NULL,
	"user_agent" text,
	"country" varchar(2),
	"region" varchar(100),
	"city" varchar(100),
	"latitude" varchar(20),
	"longitude" varchar(20),
	"device_type" varchar(20),
	"browser" varchar(50),
	"os" varchar(50),
	"session_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"flag_key" varchar(100) NOT NULL,
	"flag_value" integer DEFAULT 0 NOT NULL,
	"description" text,
	"last_modified_by" integer,
	"last_modified_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_flags_flag_key_unique" UNIQUE("flag_key")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer,
	"team_id" integer,
	"type" varchar(20) DEFAULT 'info' NOT NULL,
	"category" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"entity_id" integer,
	"entity_type" varchar(50),
	"action_url" varchar(500),
	"read" integer DEFAULT 0 NOT NULL,
	"dismissed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp,
	CONSTRAINT "notifications_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"token_type" varchar(50) DEFAULT 'Bearer',
	"scopes" text,
	"expires_at" timestamp,
	"platform_user_id" varchar(255),
	"platform_user_name" varchar(255),
	"platform_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"initiated_by" integer,
	"reset_type" varchar(20) NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"used_at" timestamp,
	"ip_address" varchar(255),
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "pattern_dimension_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern_id" integer NOT NULL,
	"dimension" varchar(50) NOT NULL,
	"successes" integer DEFAULT 0 NOT NULL,
	"trials" integer DEFAULT 0 NOT NULL,
	"wilson_score" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_behavioral_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" integer NOT NULL,
	"signal_type" varchar(100) NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"content_id" integer NOT NULL,
	"signal_value" integer NOT NULL,
	"signal_metadata" jsonb,
	"patterns_used_json" jsonb,
	"messaging_template_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "persona_behavioral_signals_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "persona_messaging_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"template_type" varchar(100) NOT NULL,
	"template" text NOT NULL,
	"trigger_condition" varchar(255),
	"times_used" integer DEFAULT 0 NOT NULL,
	"success_rate" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "persona_messaging_templates_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "publishing_callbacks" (
	"id" serial PRIMARY KEY NOT NULL,
	"publishing_job_id" integer NOT NULL,
	"status" varchar(50) NOT NULL,
	"payload" jsonb,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"response_time_ms" integer,
	"signature" varchar(255),
	"ip_address" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "publishing_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"channel" varchar(50) NOT NULL,
	"base_url" text,
	"api_key_hash" text,
	"encrypted_api_key" text,
	"capabilities" jsonb DEFAULT '{"articles":true,"images":true}'::jsonb,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"last_heartbeat_at" timestamp,
	"last_error_message" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "publishing_connections_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "publishing_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" integer NOT NULL,
	"connection_id" integer NOT NULL,
	"article_id" integer,
	"social_post_id" integer,
	"video_idea_id" integer,
	"content_type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"pg_boss_job_id" varchar(255),
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_attempt_at" timestamp,
	"next_retry_at" timestamp,
	"last_error" text,
	"error_details" jsonb,
	"published_url" text,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "publishing_jobs_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"status" varchar(50) NOT NULL,
	"batch_id" integer,
	"articles_requested" integer DEFAULT 0 NOT NULL,
	"articles_generated" integer DEFAULT 0 NOT NULL,
	"articles_published" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"ip_address" varchar(255),
	"user_agent" text,
	"device_info" jsonb,
	"is_active" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"team_context_id" integer,
	"force_logout_at" timestamp,
	"terminated_by" integer,
	"termination_reason" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "site_crawl_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"domain" varchar(500) NOT NULL,
	"base_url" text NOT NULL,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"max_pages" integer DEFAULT 50,
	"max_depth" integer DEFAULT 3,
	"pages_found" integer DEFAULT 0,
	"pages_indexed" integer DEFAULT 0,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "site_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"domain" varchar(500) NOT NULL,
	"url" text NOT NULL,
	"path" text NOT NULL,
	"title" varchar(500),
	"meta_description" text,
	"headings" jsonb,
	"content_summary" text,
	"topics" jsonb,
	"page_type" varchar(50),
	"word_count" integer,
	"last_crawled_at" timestamp DEFAULT now(),
	"is_active" integer DEFAULT 1,
	"crawl_job_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "system_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"cpu_usage_percent" integer,
	"memory_usage_mb" integer,
	"memory_total_mb" integer,
	"disk_usage_mb" integer,
	"disk_total_mb" integer,
	"queue_depth_articles" integer DEFAULT 0 NOT NULL,
	"queue_depth_social_posts" integer DEFAULT 0 NOT NULL,
	"queue_depth_videos" integer DEFAULT 0 NOT NULL,
	"active_workers" integer DEFAULT 0 NOT NULL,
	"ffmpeg_jobs_active" integer DEFAULT 0 NOT NULL,
	"ffmpeg_jobs_failed" integer DEFAULT 0 NOT NULL,
	"gemini_api_status" varchar(20) DEFAULT 'healthy' NOT NULL,
	"openai_api_status" varchar(20) DEFAULT 'healthy' NOT NULL,
	"database_status" varchar(20) DEFAULT 'healthy' NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_by" integer NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "teams_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "totp_secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"secret" varchar(64) NOT NULL,
	"backup_codes" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "totp_secrets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"invited_by" integer NOT NULL,
	"role" varchar(50) DEFAULT 'team_member' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp,
	"accepted_by" integer,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_quotas" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"role" varchar(50),
	"quota_type" varchar(50) NOT NULL,
	"limit_value" integer NOT NULL,
	"period_type" varchar(20) NOT NULL,
	"current_usage" integer DEFAULT 0 NOT NULL,
	"period_starts_at" timestamp DEFAULT now() NOT NULL,
	"period_ends_at" timestamp NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_ideas" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"team_id" integer,
	"social_post_id" integer,
	"idea_title" varchar(255) NOT NULL,
	"short_idea" text NOT NULL,
	"target_audience" varchar(255),
	"company_name" varchar(255),
	"website" varchar(500),
	"call_to_action" varchar(255) DEFAULT 'Get Started Today!' NOT NULL,
	"company_logo_url" text,
	"style" varchar(50) DEFAULT 'cinematic' NOT NULL,
	"tone" varchar(50) DEFAULT 'professional' NOT NULL,
	"expanded_concept_json" jsonb,
	"script_json" jsonb,
	"video_url" text,
	"thumbnail_url" text,
	"status" varchar(50) DEFAULT 'DRAFT' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"current_stage" varchar(50),
	"error_message" text,
	"job_id" varchar(255),
	"video_duration" integer DEFAULT 60,
	"video_resolution" varchar(20) DEFAULT '1920x1080',
	"reference_video_url" text,
	"reference_analysis_json" jsonb,
	"style_prompt" text,
	"is_like_video" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"generated_at" timestamp,
	CONSTRAINT "video_ideas_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
ALTER TABLE "batch_seo_cache" ALTER COLUMN "cache_version" SET DEFAULT '3.1';--> statement-breakpoint
ALTER TABLE "job_batches" ALTER COLUMN "core_topic" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'team_member';--> statement-breakpoint
ALTER TABLE "article_assets" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "article_assets" ADD COLUMN "team_id" integer;--> statement-breakpoint
ALTER TABLE "article_assets" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "team_id" integer;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "image_prompts_json" jsonb;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "batch_seo_cache" ADD COLUMN "local_regulations" jsonb;--> statement-breakpoint
ALTER TABLE "batch_seo_cache" ADD COLUMN "authority_entities" jsonb;--> statement-breakpoint
ALTER TABLE "batch_seo_cache" ADD COLUMN "key_statistics" jsonb;--> statement-breakpoint
ALTER TABLE "batch_seo_cache" ADD COLUMN "reddit_research" jsonb;--> statement-breakpoint
ALTER TABLE "batch_seo_cache" ADD COLUMN "expert_discovery" jsonb;--> statement-breakpoint
ALTER TABLE "error_logs" ADD COLUMN "screenshot_url" text;--> statement-breakpoint
ALTER TABLE "job_batches" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "job_batches" ADD COLUMN "team_id" integer;--> statement-breakpoint
ALTER TABLE "job_batches" ADD COLUMN "auto_publish_enabled" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_batches" ADD COLUMN "auto_publish_connection_ids" jsonb;--> statement-breakpoint
ALTER TABLE "job_batches" ADD COLUMN "persona_id" integer;--> statement-breakpoint
ALTER TABLE "job_batches" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "team_id" integer;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "video_type" varchar(20) DEFAULT 'slideshow';--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "video_title" varchar(255);--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "video_description" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "video_tags_json" jsonb;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_method" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "full_name" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_picture_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_team_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_manifests" ADD CONSTRAINT "agent_execution_manifests_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_optimization_logs" ADD CONSTRAINT "agent_optimization_logs_agent_id_learning_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."learning_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_learning_ledger" ADD CONSTRAINT "ai_learning_ledger_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_personas" ADD CONSTRAINT "audience_personas_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleanup_config" ADD CONSTRAINT "cleanup_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_audit_trails" ADD CONSTRAINT "content_audit_trails_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_clusters" ADD CONSTRAINT "content_clusters_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_clusters" ADD CONSTRAINT "content_clusters_locale_id_locales_id_fk" FOREIGN KEY ("locale_id") REFERENCES "public"."locales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_clusters" ADD CONSTRAINT "content_clusters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_performance_metrics" ADD CONSTRAINT "content_performance_metrics_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_performance_metrics" ADD CONSTRAINT "content_performance_metrics_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_performance_metrics" ADD CONSTRAINT "content_performance_metrics_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_performance_metrics" ADD CONSTRAINT "content_performance_metrics_video_idea_id_video_ideas_id_fk" FOREIGN KEY ("video_idea_id") REFERENCES "public"."video_ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reviews" ADD CONSTRAINT "content_reviews_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_schedules" ADD CONSTRAINT "content_schedules_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_schedules" ADD CONSTRAINT "content_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_nodes" ADD CONSTRAINT "coverage_nodes_cluster_id_content_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."content_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_nodes" ADD CONSTRAINT "coverage_nodes_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_codes" ADD CONSTRAINT "email_verification_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_claims" ADD CONSTRAINT "fact_claims_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_fact_id_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_versions" ADD CONSTRAINT "fact_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_verifier_id_users_id_fk" FOREIGN KEY ("verifier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_previous_version_id_facts_id_fk" FOREIGN KEY ("previous_version_id") REFERENCES "public"."facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_agents" ADD CONSTRAINT "learning_agents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_patterns" ADD CONSTRAINT "learning_patterns_agent_id_learning_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."learning_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_patterns" ADD CONSTRAINT "learning_patterns_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_flags" ADD CONSTRAINT "maintenance_flags_last_modified_by_users_id_fk" FOREIGN KEY ("last_modified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ADD CONSTRAINT "oauth_credentials_connection_id_publishing_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."publishing_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_dimension_stats" ADD CONSTRAINT "pattern_dimension_stats_pattern_id_learning_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."learning_patterns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_behavioral_signals" ADD CONSTRAINT "persona_behavioral_signals_persona_id_audience_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."audience_personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_behavioral_signals" ADD CONSTRAINT "persona_behavioral_signals_messaging_template_id_persona_messaging_templates_id_fk" FOREIGN KEY ("messaging_template_id") REFERENCES "public"."persona_messaging_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_messaging_templates" ADD CONSTRAINT "persona_messaging_templates_persona_id_audience_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."audience_personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_callbacks" ADD CONSTRAINT "publishing_callbacks_publishing_job_id_publishing_jobs_id_fk" FOREIGN KEY ("publishing_job_id") REFERENCES "public"."publishing_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_connections" ADD CONSTRAINT "publishing_connections_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_connection_id_publishing_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."publishing_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_video_idea_id_video_ideas_id_fk" FOREIGN KEY ("video_idea_id") REFERENCES "public"."video_ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_runs" ADD CONSTRAINT "schedule_runs_schedule_id_content_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."content_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_runs" ADD CONSTRAINT "schedule_runs_batch_id_job_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."job_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_team_context_id_teams_id_fk" FOREIGN KEY ("team_context_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_terminated_by_users_id_fk" FOREIGN KEY ("terminated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_secrets" ADD CONSTRAINT "totp_secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_ideas" ADD CONSTRAINT "video_ideas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_ideas" ADD CONSTRAINT "video_ideas_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_ideas" ADD CONSTRAINT "video_ideas_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_logs_team_id_action_idx" ON "activity_logs" USING btree ("team_id","action");--> statement-breakpoint
CREATE INDEX "activity_logs_action_idx" ON "activity_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_severity_idx" ON "activity_logs" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "activity_logs_target_public_id_idx" ON "activity_logs" USING btree ("target_public_id");--> statement-breakpoint
CREATE INDEX "agent_execution_manifests_public_id_idx" ON "agent_execution_manifests" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "agent_execution_manifests_team_id_idx" ON "agent_execution_manifests" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "agent_execution_manifests_execution_id_idx" ON "agent_execution_manifests" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "agent_execution_manifests_status_idx" ON "agent_execution_manifests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_optimization_logs_agent_id_idx" ON "agent_optimization_logs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_optimization_logs_type_idx" ON "agent_optimization_logs" USING btree ("optimization_type");--> statement-breakpoint
CREATE INDEX "agent_optimization_logs_created_at_idx" ON "agent_optimization_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ledger_team_content_type_idx" ON "ai_learning_ledger" USING btree ("team_id","content_type");--> statement-breakpoint
CREATE INDEX "ledger_error_type_idx" ON "ai_learning_ledger" USING btree ("error_type");--> statement-breakpoint
CREATE INDEX "ledger_last_occurrence_idx" ON "ai_learning_ledger" USING btree ("last_occurrence");--> statement-breakpoint
CREATE INDEX "audience_personas_public_id_idx" ON "audience_personas" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "audience_personas_team_id_idx" ON "audience_personas" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "audience_personas_is_active_idx" ON "audience_personas" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "audience_personas_is_default_idx" ON "audience_personas" USING btree ("is_default");--> statement-breakpoint
CREATE INDEX "cleanup_config_setting_key_idx" ON "cleanup_config" USING btree ("setting_key");--> statement-breakpoint
CREATE INDEX "cleanup_jobs_job_type_idx" ON "cleanup_jobs" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "cleanup_jobs_status_idx" ON "cleanup_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cleanup_jobs_created_at_idx" ON "cleanup_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "content_audit_trails_public_id_idx" ON "content_audit_trails" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "content_audit_trails_content_type_id_idx" ON "content_audit_trails" USING btree ("content_type","content_id");--> statement-breakpoint
CREATE INDEX "content_audit_trails_team_id_idx" ON "content_audit_trails" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "content_audit_trails_safety_score_idx" ON "content_audit_trails" USING btree ("safety_score");--> statement-breakpoint
CREATE INDEX "content_audit_trails_created_at_idx" ON "content_audit_trails" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "content_clusters_public_id_idx" ON "content_clusters" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "content_clusters_team_id_idx" ON "content_clusters" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "content_clusters_topic_location_idx" ON "content_clusters" USING btree ("topic_pillar","location");--> statement-breakpoint
CREATE INDEX "content_clusters_status_idx" ON "content_clusters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_performance_public_id_idx" ON "content_performance_metrics" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "content_performance_team_content_type_idx" ON "content_performance_metrics" USING btree ("team_id","content_type");--> statement-breakpoint
CREATE INDEX "content_performance_article_id_idx" ON "content_performance_metrics" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "content_performance_social_post_id_idx" ON "content_performance_metrics" USING btree ("social_post_id");--> statement-breakpoint
CREATE INDEX "content_performance_video_idea_id_idx" ON "content_performance_metrics" USING btree ("video_idea_id");--> statement-breakpoint
CREATE INDEX "content_performance_feedback_processed_idx" ON "content_performance_metrics" USING btree ("feedback_processed");--> statement-breakpoint
CREATE INDEX "content_performance_is_success_idx" ON "content_performance_metrics" USING btree ("is_success");--> statement-breakpoint
CREATE INDEX "content_reviews_team_type_idx" ON "content_reviews" USING btree ("team_id","content_type");--> statement-breakpoint
CREATE INDEX "content_reviews_article_idx" ON "content_reviews" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "content_reviews_reviewed_at_idx" ON "content_reviews" USING btree ("reviewed_at");--> statement-breakpoint
CREATE INDEX "content_schedules_public_id_idx" ON "content_schedules" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "content_schedules_team_id_idx" ON "content_schedules" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "content_schedules_status_idx" ON "content_schedules" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_schedules_next_run_at_idx" ON "content_schedules" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "coverage_nodes_public_id_idx" ON "coverage_nodes" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "coverage_nodes_cluster_id_idx" ON "coverage_nodes" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "coverage_nodes_subtopic_category_idx" ON "coverage_nodes" USING btree ("subtopic_category");--> statement-breakpoint
CREATE INDEX "coverage_nodes_article_id_idx" ON "coverage_nodes" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "coverage_nodes_status_idx" ON "coverage_nodes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_codes_user_id_idx" ON "email_verification_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_codes_code_idx" ON "email_verification_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "email_codes_expires_at_idx" ON "email_verification_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "fact_claims_public_id_idx" ON "fact_claims" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "fact_claims_content_type_id_idx" ON "fact_claims" USING btree ("content_type","content_id");--> statement-breakpoint
CREATE INDEX "fact_claims_team_id_idx" ON "fact_claims" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "fact_claims_validation_status_idx" ON "fact_claims" USING btree ("validation_status");--> statement-breakpoint
CREATE INDEX "fact_claims_claim_class_idx" ON "fact_claims" USING btree ("claim_class");--> statement-breakpoint
CREATE INDEX "fact_versions_fact_id_idx" ON "fact_versions" USING btree ("fact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_versions_fact_version_unique" ON "fact_versions" USING btree ("fact_id","version");--> statement-breakpoint
CREATE INDEX "facts_public_id_idx" ON "facts" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "facts_team_id_idx" ON "facts" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "facts_team_status_idx" ON "facts" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "facts_entity_type_idx" ON "facts" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "facts_category_idx" ON "facts" USING btree ("category");--> statement-breakpoint
CREATE INDEX "facts_expires_at_idx" ON "facts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "facts_confidence_idx" ON "facts" USING btree ("confidence");--> statement-breakpoint
CREATE INDEX "learning_agents_public_id_idx" ON "learning_agents" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "learning_agents_team_content_type_idx" ON "learning_agents" USING btree ("team_id","content_type");--> statement-breakpoint
CREATE INDEX "learning_agents_content_type_idx" ON "learning_agents" USING btree ("content_type");--> statement-breakpoint
CREATE INDEX "learning_agents_is_active_idx" ON "learning_agents" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "learning_patterns_public_id_idx" ON "learning_patterns" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "learning_patterns_agent_id_idx" ON "learning_patterns" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "learning_patterns_team_content_type_idx" ON "learning_patterns" USING btree ("team_id","content_type");--> statement-breakpoint
CREATE INDEX "learning_patterns_pattern_type_idx" ON "learning_patterns" USING btree ("pattern_type");--> statement-breakpoint
CREATE INDEX "learning_patterns_success_rate_idx" ON "learning_patterns" USING btree ("success_rate");--> statement-breakpoint
CREATE INDEX "local_authority_signals_public_id_idx" ON "local_authority_signals" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "local_authority_signals_entity_type_location_idx" ON "local_authority_signals" USING btree ("entity_type","location");--> statement-breakpoint
CREATE INDEX "local_authority_signals_location_idx" ON "local_authority_signals" USING btree ("location");--> statement-breakpoint
CREATE INDEX "local_authority_signals_freshness_date_idx" ON "local_authority_signals" USING btree ("freshness_date");--> statement-breakpoint
CREATE INDEX "login_history_user_id_idx" ON "login_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_history_email_idx" ON "login_history" USING btree ("email");--> statement-breakpoint
CREATE INDEX "login_history_success_idx" ON "login_history" USING btree ("success");--> statement-breakpoint
CREATE INDEX "login_history_ip_address_idx" ON "login_history" USING btree ("ip_address");--> statement-breakpoint
CREATE INDEX "login_history_created_at_idx" ON "login_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "maintenance_flags_flag_key_idx" ON "maintenance_flags" USING btree ("flag_key");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_team_id_idx" ON "notifications" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "notifications_type_idx" ON "notifications" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notifications_category_idx" ON "notifications" USING btree ("category");--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" USING btree ("read");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "oauth_credentials_connection_id_idx" ON "oauth_credentials" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "oauth_credentials_expires_at_idx" ON "oauth_credentials" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "password_resets_user_id_idx" ON "password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_resets_token_hash_idx" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_resets_status_idx" ON "password_resets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "pattern_dimension_unique" ON "pattern_dimension_stats" USING btree ("pattern_id","dimension");--> statement-breakpoint
CREATE INDEX "pattern_dimension_dim_idx" ON "pattern_dimension_stats" USING btree ("dimension");--> statement-breakpoint
CREATE INDEX "pattern_dimension_wilson_idx" ON "pattern_dimension_stats" USING btree ("wilson_score");--> statement-breakpoint
CREATE INDEX "persona_behavioral_signals_public_id_idx" ON "persona_behavioral_signals" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "persona_behavioral_signals_persona_id_idx" ON "persona_behavioral_signals" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "persona_behavioral_signals_signal_type_idx" ON "persona_behavioral_signals" USING btree ("signal_type");--> statement-breakpoint
CREATE INDEX "persona_behavioral_signals_content_type_idx" ON "persona_behavioral_signals" USING btree ("content_type");--> statement-breakpoint
CREATE INDEX "persona_behavioral_signals_created_at_idx" ON "persona_behavioral_signals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "persona_messaging_templates_public_id_idx" ON "persona_messaging_templates" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "persona_messaging_templates_persona_id_idx" ON "persona_messaging_templates" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "persona_messaging_templates_content_type_idx" ON "persona_messaging_templates" USING btree ("content_type");--> statement-breakpoint
CREATE INDEX "persona_messaging_templates_template_type_idx" ON "persona_messaging_templates" USING btree ("template_type");--> statement-breakpoint
CREATE INDEX "publishing_callbacks_job_id_idx" ON "publishing_callbacks" USING btree ("publishing_job_id");--> statement-breakpoint
CREATE INDEX "publishing_callbacks_status_idx" ON "publishing_callbacks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "publishing_callbacks_received_at_idx" ON "publishing_callbacks" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "publishing_connections_public_id_idx" ON "publishing_connections" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "publishing_connections_team_id_channel_idx" ON "publishing_connections" USING btree ("team_id","channel");--> statement-breakpoint
CREATE INDEX "publishing_connections_status_idx" ON "publishing_connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "publishing_jobs_public_id_idx" ON "publishing_jobs" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "publishing_jobs_team_id_status_idx" ON "publishing_jobs" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "publishing_jobs_connection_id_idx" ON "publishing_jobs" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "publishing_jobs_article_id_idx" ON "publishing_jobs" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "publishing_jobs_status_idx" ON "publishing_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "schedule_runs_schedule_id_idx" ON "schedule_runs" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "schedule_runs_status_idx" ON "schedule_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "schedule_runs_started_at_idx" ON "schedule_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_is_active_idx" ON "sessions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "sessions_force_logout_at_idx" ON "sessions" USING btree ("force_logout_at");--> statement-breakpoint
CREATE INDEX "system_metrics_recorded_at_idx" ON "system_metrics" USING btree ("recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_unique" ON "team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_team_id_idx" ON "team_members" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_members_user_id_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teams_public_id_idx" ON "teams" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "teams_name_idx" ON "teams" USING btree ("name");--> statement-breakpoint
CREATE INDEX "teams_created_by_idx" ON "teams" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "totp_secrets_user_id_idx" ON "totp_secrets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_invites_email_idx" ON "user_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "user_invites_token_hash_idx" ON "user_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_invites_status_idx" ON "user_invites" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_invites_expires_at_idx" ON "user_invites" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_quotas_user_id_idx" ON "user_quotas" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_quotas_role_idx" ON "user_quotas" USING btree ("role");--> statement-breakpoint
CREATE INDEX "user_quotas_quota_type_idx" ON "user_quotas" USING btree ("quota_type");--> statement-breakpoint
CREATE INDEX "video_ideas_public_id_idx" ON "video_ideas" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "video_ideas_team_id_status_idx" ON "video_ideas" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "video_ideas_user_id_idx" ON "video_ideas" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "video_ideas_style_idx" ON "video_ideas" USING btree ("style");--> statement-breakpoint
CREATE INDEX "video_ideas_status_idx" ON "video_ideas" USING btree ("status");--> statement-breakpoint
ALTER TABLE "article_assets" ADD CONSTRAINT "article_assets_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_batches" ADD CONSTRAINT "job_batches_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_default_team_id_teams_id_fk" FOREIGN KEY ("default_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_assets_public_id_idx" ON "article_assets" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "article_assets_team_id_idx" ON "article_assets" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "article_assets_article_id_idx" ON "article_assets" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "articles_public_id_idx" ON "articles" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "articles_team_id_status_idx" ON "articles" USING btree ("team_id","article_status");--> statement-breakpoint
CREATE INDEX "articles_batch_id_idx" ON "articles" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "articles_slug_idx" ON "articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "job_batches_public_id_idx" ON "job_batches" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "job_batches_team_id_status_idx" ON "job_batches" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "job_batches_user_id_idx" ON "job_batches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "social_posts_public_id_idx" ON "social_posts" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "social_posts_team_id_status_idx" ON "social_posts" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_google_id_idx" ON "users" USING btree ("google_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_public_id_idx" ON "users" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "users_default_team_id_idx" ON "users" USING btree ("default_team_id");--> statement-breakpoint
ALTER TABLE "article_assets" ADD CONSTRAINT "article_assets_public_id_unique" UNIQUE("public_id");--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_public_id_unique" UNIQUE("public_id");--> statement-breakpoint
ALTER TABLE "job_batches" ADD CONSTRAINT "job_batches_public_id_unique" UNIQUE("public_id");--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_public_id_unique" UNIQUE("public_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_public_id_unique" UNIQUE("public_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_google_id_unique" UNIQUE("google_id");