ALTER TABLE "AppVersion" ALTER COLUMN "publicationStatus" SET DEFAULT 'unpublished';--> statement-breakpoint
ALTER TABLE "AppVersion" ALTER COLUMN "publicationStatus" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "App" ALTER COLUMN "publicationStatus" SET DEFAULT 'unpublished';--> statement-breakpoint
ALTER TABLE "App" ALTER COLUMN "publicationStatus" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "reviewStatus" text;--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "reviewedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "reviewedBy" text;--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "rejectionReason" text;--> statement-breakpoint
ALTER TABLE "App" ADD COLUMN "reviewStatus" text;--> statement-breakpoint
CREATE INDEX "AppVersion_reviewStatus_idx" ON "AppVersion" USING btree ("reviewStatus");--> statement-breakpoint
CREATE INDEX "App_reviewStatus_idx" ON "App" USING btree ("reviewStatus");--> statement-breakpoint
ALTER TABLE "AppVersion" DROP COLUMN "isPublished";