CREATE TYPE "public"."ScheduledMessageStatus" AS ENUM('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "ScheduledMessage" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"draftId" text,
	"integrationId" text NOT NULL,
	"threadId" text,
	"createdById" text NOT NULL,
	"scheduledAt" timestamp (3) NOT NULL,
	"status" "ScheduledMessageStatus" DEFAULT 'PENDING' NOT NULL,
	"jobId" text,
	"sendPayload" jsonb NOT NULL,
	"failureReason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_draftId_Draft_id_fk" FOREIGN KEY ("draftId") REFERENCES "public"."Draft"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_integrationId_Integration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."Integration"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ScheduledMessage_orgId_status_scheduledAt_idx" ON "ScheduledMessage" USING btree ("organizationId","status","scheduledAt");--> statement-breakpoint
CREATE INDEX "ScheduledMessage_draftId_idx" ON "ScheduledMessage" USING btree ("draftId");