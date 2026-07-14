CREATE TYPE "public"."SequenceExitReason" AS ENUM('reply', 'bounce', 'unsubscribe', 'manual');--> statement-breakpoint
CREATE TYPE "public"."SequenceRunStatus" AS ENUM('active', 'completed', 'exited', 'failed');--> statement-breakpoint
CREATE TYPE "public"."SequenceStatus" AS ENUM('draft', 'enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."SequenceSuppressionReason" AS ENUM('unsubscribe', 'manual');--> statement-breakpoint
CREATE TABLE "Sequence" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "SequenceStatus" DEFAULT 'draft' NOT NULL,
	"workflowAppId" text NOT NULL,
	"integrationId" text NOT NULL,
	"signatureEntityInstanceId" text,
	"deliveryStartTime" text,
	"deliveryEndTime" text,
	"deliveryTimezone" text,
	"deliveryBusinessDaysOnly" boolean DEFAULT false NOT NULL,
	"publishedAt" timestamp (3),
	"hasUnpublishedChanges" boolean DEFAULT false NOT NULL,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SequenceRun" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"sequenceId" text NOT NULL,
	"workflowRunId" text NOT NULL,
	"recipientEntityInstanceId" text,
	"recipientEmail" text NOT NULL,
	"threadId" text,
	"unsubscribeToken" text NOT NULL,
	"status" "SequenceRunStatus" DEFAULT 'active' NOT NULL,
	"exitReason" "SequenceExitReason",
	"exitMetadata" jsonb,
	"lastCompletedStep" integer DEFAULT 0 NOT NULL,
	"lastSentAt" timestamp (3),
	"enrolledById" text,
	"enrolledAt" timestamp (3) DEFAULT now() NOT NULL,
	"exitedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "SequenceStep" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"sequenceId" text NOT NULL,
	"sortOrder" text COLLATE "C" DEFAULT 'a0' NOT NULL,
	"delayDays" integer DEFAULT 0 NOT NULL,
	"delayHours" integer DEFAULT 0 NOT NULL,
	"subject" text,
	"bodyJson" jsonb,
	"bodyHtml" text,
	"attachmentIds" jsonb DEFAULT '[]'::jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SequenceSuppression" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"email" text NOT NULL,
	"contactEntityInstanceId" text,
	"reason" "SequenceSuppressionReason" DEFAULT 'unsubscribe' NOT NULL,
	"sequenceRunId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD COLUMN "ownerType" text;--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD COLUMN "ownerId" text;--> statement-breakpoint
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_workflowAppId_WorkflowApp_id_fk" FOREIGN KEY ("workflowAppId") REFERENCES "public"."WorkflowApp"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_integrationId_Integration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."Integration"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_signatureEntityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("signatureEntityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SequenceRun" ADD CONSTRAINT "SequenceRun_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SequenceRun" ADD CONSTRAINT "SequenceRun_sequenceId_Sequence_id_fk" FOREIGN KEY ("sequenceId") REFERENCES "public"."Sequence"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SequenceRun" ADD CONSTRAINT "SequenceRun_workflowRunId_WorkflowRun_id_fk" FOREIGN KEY ("workflowRunId") REFERENCES "public"."WorkflowRun"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SequenceRun" ADD CONSTRAINT "SequenceRun_recipientEntityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("recipientEntityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SequenceRun" ADD CONSTRAINT "SequenceRun_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SequenceRun" ADD CONSTRAINT "SequenceRun_enrolledById_User_id_fk" FOREIGN KEY ("enrolledById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_Sequence_id_fk" FOREIGN KEY ("sequenceId") REFERENCES "public"."Sequence"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SequenceSuppression" ADD CONSTRAINT "SequenceSuppression_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SequenceSuppression" ADD CONSTRAINT "SequenceSuppression_contactEntityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("contactEntityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SequenceSuppression" ADD CONSTRAINT "SequenceSuppression_sequenceRunId_SequenceRun_id_fk" FOREIGN KEY ("sequenceRunId") REFERENCES "public"."SequenceRun"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Sequence_organizationId_idx" ON "Sequence" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Sequence_organizationId_status_idx" ON "Sequence" USING btree ("organizationId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "Sequence_workflowAppId_key" ON "Sequence" USING btree ("workflowAppId");--> statement-breakpoint
CREATE INDEX "SequenceRun_organizationId_idx" ON "SequenceRun" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "SequenceRun_sequenceId_status_idx" ON "SequenceRun" USING btree ("sequenceId","status");--> statement-breakpoint
CREATE INDEX "SequenceRun_threadId_idx" ON "SequenceRun" USING btree ("threadId");--> statement-breakpoint
CREATE UNIQUE INDEX "SequenceRun_workflowRunId_key" ON "SequenceRun" USING btree ("workflowRunId");--> statement-breakpoint
CREATE UNIQUE INDEX "SequenceRun_unsubscribeToken_key" ON "SequenceRun" USING btree ("unsubscribeToken");--> statement-breakpoint
CREATE UNIQUE INDEX "SequenceRun_sequenceId_recipient_active_key" ON "SequenceRun" USING btree ("sequenceId","recipientEntityInstanceId") WHERE "SequenceRun"."status" = 'active';--> statement-breakpoint
CREATE INDEX "SequenceStep_organizationId_idx" ON "SequenceStep" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "SequenceStep_sequenceId_sortOrder_idx" ON "SequenceStep" USING btree ("sequenceId","sortOrder");--> statement-breakpoint
CREATE INDEX "SequenceSuppression_organizationId_idx" ON "SequenceSuppression" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "SequenceSuppression_organizationId_email_key" ON "SequenceSuppression" USING btree ("organizationId","email");--> statement-breakpoint
CREATE INDEX "WorkflowApp_organizationId_ownerType_idx" ON "WorkflowApp" USING btree ("organizationId","ownerType") WHERE "ownerType" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "WorkflowApp_ownerType_ownerId_key" ON "WorkflowApp" USING btree ("ownerType","ownerId") WHERE "ownerType" IS NOT NULL;