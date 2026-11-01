ALTER TABLE "template_fields" ALTER COLUMN "options" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "template_fields" ADD COLUMN "help_text" text;