CREATE TYPE "public"."IntegrationSyncStage" AS ENUM('IDLE', 'MESSAGE_LIST_FETCH', 'MESSAGES_IMPORT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."IntegrationSyncStatus" AS ENUM('NOT_SYNCED', 'SYNCING', 'ACTIVE', 'FAILED');--> statement-breakpoint
ALTER TABLE "Integration" ADD COLUMN "syncStatus" "IntegrationSyncStatus" DEFAULT 'NOT_SYNCED' NOT NULL;--> statement-breakpoint
ALTER TABLE "Integration" ADD COLUMN "syncStage" "IntegrationSyncStage" DEFAULT 'IDLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "Integration" ADD COLUMN "syncStageStartedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Integration" ADD COLUMN "throttleFailureCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "Integration" ADD COLUMN "throttleRetryAfter" timestamp (3);--> statement-breakpoint
CREATE INDEX "Integration_syncStatus_idx" ON "Integration" USING btree ("syncStatus");