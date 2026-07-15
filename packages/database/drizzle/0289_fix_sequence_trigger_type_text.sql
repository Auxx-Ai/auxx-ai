ALTER TABLE "Sequence" ALTER COLUMN "triggerType" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "Sequence" ALTER COLUMN "triggerType" SET DEFAULT 'manual';--> statement-breakpoint
DROP TYPE "public"."SequenceTriggerType";