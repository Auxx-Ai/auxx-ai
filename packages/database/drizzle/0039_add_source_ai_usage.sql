ALTER TABLE "AiUsage" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "AiUsage" ADD COLUMN "sourceId" text;--> statement-breakpoint
CREATE INDEX "AiUsage_source_idx" ON "AiUsage" USING btree ("source");