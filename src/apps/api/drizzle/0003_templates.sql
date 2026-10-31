CREATE TABLE "template_access" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" text NOT NULL,
	"member_id" text,
	"team_id" text,
	"level" text DEFAULT 'view' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_access_template_id_member_id_unique" UNIQUE("template_id","member_id"),
	CONSTRAINT "template_access_template_id_team_id_unique" UNIQUE("template_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "template_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_version_id" text NOT NULL,
	"template_step_id" text NOT NULL,
	"position" integer NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_fields_template_version_id_key_unique" UNIQUE("template_version_id","key")
);
--> statement-breakpoint
CREATE TABLE "template_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_version_id" text NOT NULL,
	"kind" text DEFAULT 'task' NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"is_halt" boolean DEFAULT false NOT NULL,
	"skippable" boolean DEFAULT false NOT NULL,
	"assignee_type" text,
	"assignee_ref" text,
	"due_offset" interval,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_steps_id_template_version_id_organization_id_unique" UNIQUE("id","template_version_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "template_access" ADD CONSTRAINT "template_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_access" ADD CONSTRAINT "template_access_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_access" ADD CONSTRAINT "template_access_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_access" ADD CONSTRAINT "template_access_template_id_fk" FOREIGN KEY ("template_id","organization_id") REFERENCES "public"."templates"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_fields" ADD CONSTRAINT "template_fields_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_fields" ADD CONSTRAINT "template_fields_template_steps_id_fk" FOREIGN KEY ("template_step_id","template_version_id","organization_id") REFERENCES "public"."template_steps"("id","template_version_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_steps" ADD CONSTRAINT "template_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_steps" ADD CONSTRAINT "template_steps_template_versions_id_fk" FOREIGN KEY ("template_version_id","organization_id") REFERENCES "public"."template_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_access_member_idx" ON "template_access" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "template_access_team_idx" ON "template_access" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "template_fields_step_position_idx" ON "template_fields" USING btree ("template_step_id","position");--> statement-breakpoint
CREATE INDEX "template_steps_version_position_idx" ON "template_steps" USING btree ("template_version_id","position");--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_id_organization_id_unique" UNIQUE("id","organization_id");