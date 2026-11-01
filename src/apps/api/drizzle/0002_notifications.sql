CREATE TABLE "notification_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"notification_id" text NOT NULL,
	"recipient" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_notification_id_channel_unique" UNIQUE("notification_id","channel")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "notifications_member_id_dedupe_key_unique" UNIQUE("member_id","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fk" FOREIGN KEY ("organization_id","notification_id") REFERENCES "public"."notifications"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_member_id_created_at_idx" ON "notifications" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_subject_type_subject_id_idx" ON "notifications" USING btree ("subject_type","subject_id");