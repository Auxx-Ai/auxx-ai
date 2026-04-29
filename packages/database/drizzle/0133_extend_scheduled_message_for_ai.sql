CREATE TYPE "public"."ScheduledMessageSource" AS ENUM('USER_SCHEDULED', 'AI_SUGGESTED', 'AUTO_REPLY');--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD COLUMN "source" "ScheduledMessageSource" DEFAULT 'USER_SCHEDULED' NOT NULL;--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD COLUMN "approvedById" text;--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD COLUMN "cancelledAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD COLUMN "cancelledById" text;--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD COLUMN "aiSuggestionId" text;--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_approvedById_User_id_fk" FOREIGN KEY ("approvedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_cancelledById_User_id_fk" FOREIGN KEY ("cancelledById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_aiSuggestionId_AiSuggestion_id_fk" FOREIGN KEY ("aiSuggestionId") REFERENCES "public"."AiSuggestion"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ScheduledMessage_orgId_source_approvedById_status_idx" ON "ScheduledMessage" USING btree ("organizationId","source","approvedById","status");