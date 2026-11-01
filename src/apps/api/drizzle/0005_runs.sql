CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_version_id" text NOT NULL,
	"schedule_id" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_template_version_id_fk" FOREIGN KEY ("template_version_id","organization_id") REFERENCES "public"."template_versions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_schedule_id_fk" FOREIGN KEY ("schedule_id","organization_id") REFERENCES "public"."schedules"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_organization_status_idx" ON "runs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "runs_template_version_idx" ON "runs" USING btree ("template_version_id");--> statement-breakpoint
CREATE INDEX "runs_schedule_idx" ON "runs" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "schedules_due_idx" ON "schedules" USING btree ("next_run_at");--> statement-breakpoint
ALTER TABLE "schedules" DROP COLUMN "active";--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_id_organization_id_unique" UNIQUE("id","organization_id");