ALTER TABLE "Dashboard" ADD COLUMN "draftLayout" jsonb;--> statement-breakpoint
ALTER TABLE "Dashboard" ADD COLUMN "hasUnpublishedChanges" boolean DEFAULT false NOT NULL;