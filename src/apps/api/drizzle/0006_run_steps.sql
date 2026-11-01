CREATE TABLE "run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL,
	"template_version_id" text NOT NULL,
	"template_step_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"assignee_member_id" text,
	"assignee_team_id" text,
	"assignee_role" text,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_steps_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "run_steps_run_id_template_step_id_unique" UNIQUE("run_id","template_step_id")
);
--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_assignee_member_id_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_assignee_team_id_teams_id_fk" FOREIGN KEY ("assignee_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_fk" FOREIGN KEY ("run_id","template_version_id","organization_id") REFERENCES "public"."runs"("id","template_version_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_template_step_id_fk" FOREIGN KEY ("template_step_id","template_version_id","organization_id") REFERENCES "public"."template_steps"("id","template_version_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_steps_template_step_id_idx" ON "run_steps" USING btree ("template_step_id");--> statement-breakpoint
CREATE INDEX "run_steps_assignee_member_id_idx" ON "run_steps" USING btree ("assignee_member_id");--> statement-breakpoint
CREATE INDEX "run_steps_assignee_team_id_idx" ON "run_steps" USING btree ("assignee_team_id");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_id_template_version_id_organization_id_unique" UNIQUE("id","template_version_id","organization_id");