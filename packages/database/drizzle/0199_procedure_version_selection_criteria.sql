ALTER TABLE "ProcedureVersion" ADD COLUMN "whenToUse" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ProcedureVersion" ADD COLUMN "triggerExamples" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ProcedureVersion" ADD COLUMN "ruleset" jsonb DEFAULT '[]'::jsonb NOT NULL;