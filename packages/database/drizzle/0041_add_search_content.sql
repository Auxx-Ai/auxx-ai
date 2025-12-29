DROP INDEX "idx_document_segment_content_search";--> statement-breakpoint
ALTER TABLE "DocumentSegment" ADD COLUMN "searchVector" "tsvector";--> statement-breakpoint
CREATE INDEX "idx_dataset_org_status" ON "Dataset" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX "idx_document_segment_search_vector" ON "DocumentSegment" USING gin ("searchVector");--> statement-breakpoint
CREATE INDEX "idx_document_dataset_enabled" ON "Document" USING btree ("datasetId") WHERE enabled = true;