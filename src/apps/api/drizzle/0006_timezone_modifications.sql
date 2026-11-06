ALTER TABLE "template_steps" ALTER COLUMN "due_offset" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "timezone" text NOT NULL;