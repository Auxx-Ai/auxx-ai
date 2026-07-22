ALTER TYPE "public"."NotificationType" ADD VALUE 'TASK_AUTO_COMPLETED';--> statement-breakpoint
ALTER TABLE "RecordRule" ADD COLUMN "signalKind" text;--> statement-breakpoint
ALTER TABLE "RecordRule" ADD COLUMN "templateKey" text;--> statement-breakpoint
ALTER TABLE "Task" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "Task" ADD COLUMN "sourceRuleId" text;--> statement-breakpoint
ALTER TABLE "Task" ADD COLUMN "sourceSignalId" text;--> statement-breakpoint
ALTER TABLE "Task" ADD COLUMN "autoCompleteOn" text;--> statement-breakpoint
ALTER TABLE "Task" ADD COLUMN "snoozedUntil" timestamp (3);--> statement-breakpoint
CREATE UNIQUE INDEX "RecordRule_organizationId_templateKey_idx" ON "RecordRule" USING btree ("organizationId","templateKey") WHERE "templateKey" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "Task_organizationId_sourceRuleId_idx" ON "Task" USING btree ("organizationId","sourceRuleId");