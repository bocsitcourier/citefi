CREATE TABLE "credit_menu_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer,
	"operation_type" varchar(50) NOT NULL,
	"cost_override" integer NOT NULL,
	"admin_user_id" integer,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_menu_overrides" ADD CONSTRAINT "credit_menu_overrides_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_menu_overrides" ADD CONSTRAINT "credit_menu_overrides_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cmo_op_team_idx" ON "credit_menu_overrides" USING btree ("operation_type","team_id");