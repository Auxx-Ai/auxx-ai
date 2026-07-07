ALTER TABLE "ResourceAccess" ADD COLUMN "lens" text;--> statement-breakpoint
-- Backfill: existing view grants become full-lens (mail-permissions §2.1).
UPDATE "ResourceAccess" SET "lens" = 'full' WHERE "permission" = 'view' AND "lens" IS NULL;