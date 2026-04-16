CREATE TYPE "public"."AiProcessingStatus" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "CallRecording" ADD COLUMN "summaryText" text;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD COLUMN "actionItems" jsonb;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD COLUMN "aiProcessingStatus" "AiProcessingStatus" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD COLUMN "aiProcessingError" text;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD COLUMN "aiProcessedAt" timestamp (3) with time zone;