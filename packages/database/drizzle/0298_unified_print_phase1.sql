ALTER TABLE "ExportJob" ADD COLUMN "format" text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "ExportJob" ADD COLUMN "printConfig" jsonb;--> statement-breakpoint
ALTER TABLE "ExportJob" ADD COLUMN "recordIds" jsonb;