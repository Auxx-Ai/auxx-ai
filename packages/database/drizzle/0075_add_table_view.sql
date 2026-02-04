DROP INDEX "TableView_tableId_organizationId_isDefault_key";--> statement-breakpoint
DROP INDEX "TableView_tableId_userId_name_key";--> statement-breakpoint
ALTER TABLE "TableView" ADD COLUMN "contextType" text DEFAULT 'table' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "TableView_tableId_organizationId_contextType_isDefault_key" ON "TableView" USING btree ("tableId","organizationId","contextType") WHERE "TableView"."isDefault" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "TableView_tableId_userId_name_contextType_key" ON "TableView" USING btree ("tableId","userId","name","contextType");