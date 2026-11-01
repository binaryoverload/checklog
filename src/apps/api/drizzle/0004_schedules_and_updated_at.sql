CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" text NOT NULL,
	"rrule" text NOT NULL,
	"timezone" text NOT NULL,
	"next_run_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"run_name_pattern" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template_access" ADD COLUMN "created_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "template_access" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "template_fields" ADD COLUMN "created_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "template_fields" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "template_steps" ADD COLUMN "created_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "template_steps" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "created_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "created_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_template_id_fk" FOREIGN KEY ("template_id","organization_id") REFERENCES "public"."templates"("id","organization_id") ON DELETE cascade ON UPDATE no action;