CREATE TABLE "billing_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"stripe_event_id" varchar(255) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"team_id" integer,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"payload" jsonb,
	CONSTRAINT "billing_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "cadence_performance" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"weekly_frequency" integer NOT NULL,
	"avg_engagement_score" integer DEFAULT 0 NOT NULL,
	"avg_conversion_rate" integer DEFAULT 0 NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_brand_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"website_url" text NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"progress_step" varchar(50),
	"profile_json" jsonb,
	"raw_research_json" jsonb,
	"manual_overrides_json" jsonb,
	"error_message" text,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_brand_profiles_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
CREATE TABLE "client_intelligence" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"content_type" varchar(20) NOT NULL,
	"article_id" integer,
	"social_post_id" integer,
	"window_days" integer DEFAULT 30 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"unique_sessions" integer DEFAULT 0 NOT NULL,
	"ctr" real DEFAULT 0 NOT NULL,
	"conversion_rate" real DEFAULT 0 NOT NULL,
	"engagement_score" real DEFAULT 0 NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cohort_insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"cohort_dimension" varchar(100) NOT NULL,
	"cohort_value" varchar(255) NOT NULL,
	"conversion_rate" integer DEFAULT 0 NOT NULL,
	"engagement_score" integer DEFAULT 0 NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"vs_baseline_multiplier" integer DEFAULT 100 NOT NULL,
	"insight_type" varchar(50) DEFAULT 'converter_cohort' NOT NULL,
	"recommendation_text" text,
	"terminal_kpi" varchar(30),
	"content_type_blocked" varchar(50),
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"content_type" varchar(20) NOT NULL,
	"article_id" integer,
	"social_post_id" integer,
	"event_type" varchar(30) NOT NULL,
	"session_id" varchar(100),
	"visitor_id" varchar(100),
	"variant_id" varchar(100),
	"arm_id" integer,
	"ip_hash" varchar(64),
	"scroll_pct" smallint,
	"engaged_sec" integer,
	"read_complete" boolean DEFAULT false,
	"bounced" boolean DEFAULT false,
	"fatigue_signal" boolean DEFAULT false,
	"conversion_type" varchar(50),
	"conversion_value" real,
	"channel" varchar(30),
	"utm_source" varchar(100),
	"utm_medium" varchar(100),
	"utm_campaign" varchar(100),
	"utm_content" varchar(100),
	"device" varchar(20),
	"locale" varchar(20),
	"journey_id" varchar(100),
	"journey_step" smallint,
	"is_return" boolean DEFAULT false,
	"session_count" smallint,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"article_id" integer,
	"social_post_id" integer,
	"video_idea_id" integer,
	"rating" varchar(10) NOT NULL,
	"comment" text,
	"metric_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer,
	"user_id" integer,
	"batch_id" integer,
	"article_id" integer,
	"job_id" varchar(100),
	"operation_type" varchar(50) NOT NULL,
	"provider" varchar(20) NOT NULL,
	"model" varchar(100) NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"unit_type" varchar(20) DEFAULT 'tokens' NOT NULL,
	"unit_count" integer,
	"cost_microusd" integer DEFAULT 0 NOT NULL,
	"success" integer DEFAULT 1 NOT NULL,
	"latency_ms" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"allowance_credits" integer DEFAULT 0 NOT NULL,
	"purchased_credits" integer DEFAULT 0 NOT NULL,
	"allowance_used" integer DEFAULT 0 NOT NULL,
	"purchased_used" integer DEFAULT 0 NOT NULL,
	"reserved_credits" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_balances_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"user_id" integer,
	"admin_user_id" integer,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"event_type" varchar(30) NOT NULL,
	"bucket" varchar(20),
	"run_id" varchar(255),
	"operation_type" varchar(50),
	"product_type" varchar(30),
	"source_type" varchar(30),
	"source_id" integer,
	"job_id" varchar(255),
	"idempotency_key" varchar(255),
	"reason" text,
	"reversed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "decision_arms" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"content_type" varchar(20) NOT NULL,
	"article_id" integer,
	"social_post_id" integer,
	"label" varchar(100),
	"prior_alpha" real DEFAULT 1 NOT NULL,
	"prior_beta" real DEFAULT 1 NOT NULL,
	"posterior_alpha" real DEFAULT 1 NOT NULL,
	"posterior_beta" real DEFAULT 1 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"content_type" varchar(20) DEFAULT 'article' NOT NULL,
	"objective" varchar(50) DEFAULT 'maximize_conversions' NOT NULL,
	"exploration_rate" real DEFAULT 0.1 NOT NULL,
	"holdout_percent" real DEFAULT 0.1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdout_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"policy_id" integer NOT NULL,
	"visitor_hash" varchar(64) NOT NULL,
	"is_holdout" boolean DEFAULT false NOT NULL,
	"arm_id" integer,
	"outcome" varchar(20),
	"assigned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"journey_id" integer NOT NULL,
	"step_index" integer NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"day_offset" integer DEFAULT 0 NOT NULL,
	"topic_angle" text,
	"channel" varchar(50),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"article_id" integer,
	"batch_id" integer,
	"scheduled_for" timestamp,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"template_type" varchar(50) NOT NULL,
	"steps_config" jsonb DEFAULT '[]' NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"template_type" varchar(50),
	"template_id" integer,
	"trigger_type" varchar(20) DEFAULT 'manual' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"terminal_kpi" varchar(50) NOT NULL,
	"locale" varchar(20),
	"locale_config" jsonb,
	"trigger_article_id" integer,
	"triggered_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judge_recalibration_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"article_id" integer,
	"social_post_id" integer,
	"video_idea_id" integer,
	"human_rating" integer NOT NULL,
	"human_is_success" boolean NOT NULL,
	"judge_score" integer,
	"judge_dimension_scores" jsonb,
	"conflict_dimension" varchar(50),
	"conflict_magnitude" integer,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"review_notes" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_windows" (
	"key_hash" varchar(64) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_arms" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"arm_name" varchar(50) DEFAULT 'treatment' NOT NULL,
	"allocation_pct" integer DEFAULT 90 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"terminal_kpi" varchar(50),
	"baseline_pattern_ids" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audience_personas" ADD COLUMN "performance_notes" text;--> statement-breakpoint
ALTER TABLE "content_performance_metrics" ADD COLUMN "scroll_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_performance_metrics" ADD COLUMN "read_complete_rate" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_performance_metrics" ADD COLUMN "session_return_rate" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_performance_metrics" ADD COLUMN "variant_id" varchar(36);--> statement-breakpoint
ALTER TABLE "content_performance_metrics" ADD COLUMN "arm_id" integer;--> statement-breakpoint
ALTER TABLE "content_performance_metrics" ADD COLUMN "variant_arm_id" integer;--> statement-breakpoint
ALTER TABLE "learning_patterns" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_patterns" ADD COLUMN "weak_week_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_patterns" ADD COLUMN "source" varchar(20) DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_patterns" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "learning_patterns" ADD COLUMN "external_platform" varchar(50);--> statement-breakpoint
ALTER TABLE "learning_patterns" ADD COLUMN "validated_by_own_audience" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "request_key" varchar(255);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "stripe_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "stripe_subscription_id" varchar(255);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "billing_plan" varchar(30) DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "billing_status" varchar(30) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "current_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "parent_team_id" integer;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "client_status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "conversion_webhook_secret" varchar(100);--> statement-breakpoint
ALTER TABLE "user_invites" ADD COLUMN "team_id" integer;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadence_performance" ADD CONSTRAINT "cadence_performance_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_brand_profiles" ADD CONSTRAINT "client_brand_profiles_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_intelligence" ADD CONSTRAINT "client_intelligence_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_intelligence" ADD CONSTRAINT "client_intelligence_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_intelligence" ADD CONSTRAINT "client_intelligence_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohort_insights" ADD CONSTRAINT "cohort_insights_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_events" ADD CONSTRAINT "content_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_events" ADD CONSTRAINT "content_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_events" ADD CONSTRAINT "content_events_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD CONSTRAINT "content_feedback_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD CONSTRAINT "content_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD CONSTRAINT "content_feedback_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD CONSTRAINT "content_feedback_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD CONSTRAINT "content_feedback_video_idea_id_video_ideas_id_fk" FOREIGN KEY ("video_idea_id") REFERENCES "public"."video_ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_arms" ADD CONSTRAINT "decision_arms_policy_id_decision_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."decision_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_arms" ADD CONSTRAINT "decision_arms_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_arms" ADD CONSTRAINT "decision_arms_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_arms" ADD CONSTRAINT "decision_arms_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_policies" ADD CONSTRAINT "decision_policies_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdout_assignments" ADD CONSTRAINT "holdout_assignments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdout_assignments" ADD CONSTRAINT "holdout_assignments_policy_id_decision_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."decision_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdout_assignments" ADD CONSTRAINT "holdout_assignments_arm_id_decision_arms_id_fk" FOREIGN KEY ("arm_id") REFERENCES "public"."decision_arms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_steps" ADD CONSTRAINT "journey_steps_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_template_id_journey_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."journey_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_recalibration_queue" ADD CONSTRAINT "judge_recalibration_queue_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_recalibration_queue" ADD CONSTRAINT "judge_recalibration_queue_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_recalibration_queue" ADD CONSTRAINT "judge_recalibration_queue_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_recalibration_queue" ADD CONSTRAINT "judge_recalibration_queue_video_idea_id_video_ideas_id_fk" FOREIGN KEY ("video_idea_id") REFERENCES "public"."video_ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_arms" ADD CONSTRAINT "variant_arms_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_stripe_event_idx" ON "billing_events" USING btree ("stripe_event_id");--> statement-breakpoint
CREATE INDEX "billing_events_team_idx" ON "billing_events" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "cp_team_idx" ON "cadence_performance" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "cp_team_content_idx" ON "cadence_performance" USING btree ("team_id","content_type");--> statement-breakpoint
CREATE INDEX "cp_computed_at_idx" ON "cadence_performance" USING btree ("computed_at");--> statement-breakpoint
CREATE INDEX "cbp_team_id_idx" ON "client_brand_profiles" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "cbp_status_idx" ON "client_brand_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "client_intelligence_team_id_idx" ON "client_intelligence" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "client_intelligence_engagement_idx" ON "client_intelligence" USING btree ("engagement_score");--> statement-breakpoint
CREATE INDEX "client_intelligence_article_id_idx" ON "client_intelligence" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "client_intelligence_social_post_id_idx" ON "client_intelligence" USING btree ("social_post_id");--> statement-breakpoint
CREATE INDEX "ci_team_idx" ON "cohort_insights" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "ci_insight_type_idx" ON "cohort_insights" USING btree ("insight_type");--> statement-breakpoint
CREATE INDEX "ci_computed_at_idx" ON "cohort_insights" USING btree ("computed_at");--> statement-breakpoint
CREATE INDEX "ci_team_type_idx" ON "cohort_insights" USING btree ("team_id","insight_type");--> statement-breakpoint
CREATE INDEX "content_events_team_id_idx" ON "content_events" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "content_events_event_type_idx" ON "content_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "content_events_article_id_idx" ON "content_events" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "content_events_social_post_id_idx" ON "content_events" USING btree ("social_post_id");--> statement-breakpoint
CREATE INDEX "content_events_created_at_idx" ON "content_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "content_events_visitor_id_idx" ON "content_events" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "content_events_arm_id_idx" ON "content_events" USING btree ("arm_id");--> statement-breakpoint
CREATE INDEX "content_feedback_team_id_idx" ON "content_feedback" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "content_feedback_content_type_idx" ON "content_feedback" USING btree ("content_type");--> statement-breakpoint
CREATE INDEX "content_feedback_rating_idx" ON "content_feedback" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "content_feedback_created_at_idx" ON "content_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cost_telemetry_team_created_idx" ON "cost_telemetry" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "cost_telemetry_op_type_idx" ON "cost_telemetry" USING btree ("operation_type","created_at");--> statement-breakpoint
CREATE INDEX "cost_telemetry_provider_model_idx" ON "cost_telemetry" USING btree ("provider","model");--> statement-breakpoint
CREATE INDEX "cost_telemetry_batch_idx" ON "cost_telemetry" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "cost_telemetry_article_idx" ON "cost_telemetry" USING btree ("article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_balances_team_idx" ON "credit_balances" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_team_created_idx" ON "credit_ledger" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_product_idx" ON "credit_ledger" USING btree ("product_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_idempotency_idx" ON "credit_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_ledger_run_id_idx" ON "credit_ledger" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "decision_arms_policy_id_idx" ON "decision_arms" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "decision_arms_team_id_idx" ON "decision_arms" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "decision_policies_team_id_idx" ON "decision_policies" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holdout_assignments_policy_visitor_idx" ON "holdout_assignments" USING btree ("policy_id","visitor_hash");--> statement-breakpoint
CREATE INDEX "holdout_assignments_team_id_idx" ON "holdout_assignments" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "js_journey_idx" ON "journey_steps" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "js_status_idx" ON "journey_steps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "js_scheduled_idx" ON "journey_steps" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "js_status_scheduled_idx" ON "journey_steps" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "jt_type_idx" ON "journey_templates" USING btree ("template_type");--> statement-breakpoint
CREATE INDEX "jt_builtin_idx" ON "journey_templates" USING btree ("is_builtin");--> statement-breakpoint
CREATE INDEX "j_team_idx" ON "journeys" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "j_status_idx" ON "journeys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "j_team_status_idx" ON "journeys" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "jrq_team_idx" ON "judge_recalibration_queue" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "jrq_status_idx" ON "judge_recalibration_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jrq_created_at_idx" ON "judge_recalibration_queue" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "jrq_team_status_idx" ON "judge_recalibration_queue" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "rate_limit_windows_reset_at_idx" ON "rate_limit_windows" USING btree ("reset_at");--> statement-breakpoint
CREATE INDEX "va_team_content_idx" ON "variant_arms" USING btree ("team_id","content_type");--> statement-breakpoint
CREATE INDEX "va_active_idx" ON "variant_arms" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "content_performance_metrics" ADD CONSTRAINT "content_performance_metrics_arm_id_decision_arms_id_fk" FOREIGN KEY ("arm_id") REFERENCES "public"."decision_arms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_performance_metrics" ADD CONSTRAINT "content_performance_metrics_variant_arm_id_variant_arms_id_fk" FOREIGN KEY ("variant_arm_id") REFERENCES "public"."variant_arms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_parent_team_id_teams_id_fk" FOREIGN KEY ("parent_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_performance_variant_id_idx" ON "content_performance_metrics" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "content_performance_arm_id_idx" ON "content_performance_metrics" USING btree ("arm_id");--> statement-breakpoint
CREATE INDEX "learning_patterns_archived_idx" ON "learning_patterns" USING btree ("is_archived");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_team_request_key_idx" ON "social_posts" USING btree ("team_id","request_key");--> statement-breakpoint
CREATE INDEX "teams_stripe_customer_idx" ON "teams" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "teams_parent_team_idx" ON "teams" USING btree ("parent_team_id");--> statement-breakpoint
CREATE INDEX "teams_parent_client_status_idx" ON "teams" USING btree ("parent_team_id","client_status");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_stripe_customer_id_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");