ALTER TABLE "CustomField" ADD COLUMN "sortOrder" text DEFAULT 'a0' NOT NULL;--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "displayOptions" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
CREATE INDEX "CustomField_organizationId_entityDefinitionId_sortOrder_idx" ON "CustomField" USING btree ("organizationId","entityDefinitionId","sortOrder");--> statement-breakpoint
ALTER TABLE "CustomField" DROP COLUMN "position";