ALTER TABLE "ExportBatch" ADD COLUMN "failureClass" text;--> statement-breakpoint
ALTER TABLE "ExportBatch" ADD COLUMN "failureItems" jsonb;--> statement-breakpoint
ALTER TABLE "ExportBatch" ADD CONSTRAINT "ExportBatch_failureClass_check" CHECK ("ExportBatch"."failureClass" IS NULL OR "ExportBatch"."failureClass" IN ('configuration','data','transport'));