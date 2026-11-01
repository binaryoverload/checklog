ALTER TABLE "run_steps" ADD COLUMN "assignee_type" text;--> statement-breakpoint
ALTER TABLE "template_steps" ADD COLUMN "assignee_member_id" text;--> statement-breakpoint
ALTER TABLE "template_steps" ADD COLUMN "assignee_team_id" text;--> statement-breakpoint
ALTER TABLE "template_steps" ADD COLUMN "assignee_role" text;--> statement-breakpoint
ALTER TABLE "template_steps" ADD CONSTRAINT "template_steps_assignee_member_id_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_steps" ADD CONSTRAINT "template_steps_assignee_team_id_teams_id_fk" FOREIGN KEY ("assignee_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_steps" DROP COLUMN "assignee_ref";