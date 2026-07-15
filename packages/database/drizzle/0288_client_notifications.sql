CREATE TYPE "public"."SequenceTriggerType" AS ENUM('manual', 'visit:scheduled', 'visit:en_route', 'visit:completed', 'work_order:completed', 'invoice:sent');--> statement-breakpoint
ALTER TYPE "public"."NotificationType" ADD VALUE 'VISIT_RESCHEDULED';--> statement-breakpoint
ALTER TYPE "public"."NotificationType" ADD VALUE 'VISIT_CANCELED';--> statement-breakpoint
ALTER TYPE "public"."NotificationType" ADD VALUE 'VISIT_REASSIGNED';--> statement-breakpoint
ALTER TYPE "public"."SequenceExitReason" ADD VALUE 'canceled';--> statement-breakpoint
ALTER TYPE "public"."SequenceExitReason" ADD VALUE 'completed_subject';--> statement-breakpoint
ALTER TYPE "public"."SequenceExitReason" ADD VALUE 'paid';--> statement-breakpoint
ALTER TYPE "public"."SequenceExitReason" ADD VALUE 'disabled';--> statement-breakpoint
CREATE TABLE "EntitySignal" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"kind" text NOT NULL,
	"subtype" text NOT NULL,
	"occurredAt" timestamp (3) NOT NULL,
	"dedupeKey" text,
	"isBot" boolean DEFAULT false NOT NULL,
	"contactEntityInstanceId" text,
	"messageId" text,
	"threadId" text,
	"title" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "EntitySignalLink" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"signalId" text NOT NULL,
	"recordKey" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "SequenceRun_sequenceId_recipient_active_key";--> statement-breakpoint
ALTER TABLE "Sequence" ADD COLUMN "triggerType" "SequenceTriggerType" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "Sequence" ADD COLUMN "subjectKind" text;--> statement-breakpoint
ALTER TABLE "Sequence" ADD COLUMN "exitOnReply" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "Sequence" ADD COLUMN "respectSuppression" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "Sequence" ADD COLUMN "includeUnsubscribeFooter" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "Sequence" ADD COLUMN "templateKey" text;--> statement-breakpoint
ALTER TABLE "Sequence" ADD COLUMN "enrollmentFilter" jsonb;--> statement-breakpoint
ALTER TABLE "SequenceRun" ADD COLUMN "subjectKind" text;--> statement-breakpoint
ALTER TABLE "SequenceRun" ADD COLUMN "subjectId" text;--> statement-breakpoint
ALTER TABLE "SequenceStep" ADD COLUMN "timingMode" text DEFAULT 'relative' NOT NULL;--> statement-breakpoint
ALTER TABLE "SequenceStep" ADD COLUMN "anchorOffsetDays" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "SequenceStep" ADD COLUMN "anchorTimeOfDay" text;--> statement-breakpoint
ALTER TABLE "SequenceStep" ADD COLUMN "channel" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "EntitySignal" ADD CONSTRAINT "EntitySignal_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntitySignal" ADD CONSTRAINT "EntitySignal_contactEntityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("contactEntityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntitySignalLink" ADD CONSTRAINT "EntitySignalLink_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntitySignalLink" ADD CONSTRAINT "EntitySignalLink_signalId_EntitySignal_id_fk" FOREIGN KEY ("signalId") REFERENCES "public"."EntitySignal"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "EntitySignal_organizationId_idx" ON "EntitySignal" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "EntitySignal_contactEntityInstanceId_idx" ON "EntitySignal" USING btree ("contactEntityInstanceId");--> statement-breakpoint
CREATE UNIQUE INDEX "EntitySignal_organizationId_dedupeKey_key" ON "EntitySignal" USING btree ("organizationId","dedupeKey") WHERE "EntitySignal"."dedupeKey" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "EntitySignalLink_organizationId_recordKey_signalId_idx" ON "EntitySignalLink" USING btree ("organizationId","recordKey","signalId");--> statement-breakpoint
CREATE INDEX "Sequence_organizationId_triggerType_idx" ON "Sequence" USING btree ("organizationId","triggerType");--> statement-breakpoint
CREATE UNIQUE INDEX "Sequence_organizationId_templateKey_key" ON "Sequence" USING btree ("organizationId","templateKey") WHERE "Sequence"."templateKey" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "SequenceRun_sequenceId_subject_active_key" ON "SequenceRun" USING btree ("sequenceId","subjectId") WHERE "SequenceRun"."status" = 'active' AND "SequenceRun"."subjectId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "SequenceRun_sequenceId_subjectId_idx" ON "SequenceRun" USING btree ("sequenceId","subjectId");--> statement-breakpoint
CREATE UNIQUE INDEX "SequenceRun_sequenceId_recipient_active_key" ON "SequenceRun" USING btree ("sequenceId","recipientEntityInstanceId") WHERE "SequenceRun"."status" = 'active' AND "SequenceRun"."subjectId" IS NULL;