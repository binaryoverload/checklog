CREATE TABLE "approval_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"approval_request_id" text NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"run_step_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "approval_requests_organization_id_run_step_id_unique" UNIQUE("organization_id","run_step_id")
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approval_request_id_fk" FOREIGN KEY ("organization_id","approval_request_id") REFERENCES "public"."approval_requests"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_run_step_id_fk" FOREIGN KEY ("organization_id","run_step_id") REFERENCES "public"."run_steps"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_decisions_approval_request_id_idx" ON "approval_decisions" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "approval_requests_run_step_id_idx" ON "approval_requests" USING btree ("run_step_id");