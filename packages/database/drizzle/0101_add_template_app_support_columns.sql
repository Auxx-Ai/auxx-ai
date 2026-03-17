ALTER TABLE "WorkflowTemplate" ADD COLUMN "requiredApps" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "WorkflowTemplate" ADD COLUMN "requiredEntities" jsonb DEFAULT '[]'::jsonb;