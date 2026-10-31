ALTER TABLE "organizations" ADD COLUMN "account_type" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "managed_by_organization_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_managed_by_organization_id_organizations_id_fk" FOREIGN KEY ("managed_by_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizations_purgeAfter_idx" ON "organizations" USING btree ("purge_after");