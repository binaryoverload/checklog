CREATE TABLE "template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_versions_id_template_id_unique" UNIQUE("id","template_id"),
	CONSTRAINT "template_versions_template_id_version_unique" UNIQUE("template_id","version")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"current_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_id_organization_id_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_fk" FOREIGN KEY ("template_id","organization_id") REFERENCES "public"."templates"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_current_version_id_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."template_versions"("id","template_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_one_draft_idx" ON "template_versions" USING btree ("template_id") WHERE "template_versions"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "templates_name_unique_idx" ON "templates" USING btree ("name","organization_id") WHERE "templates"."status" = 'active';