ALTER TABLE "AppWebhookHandler" ALTER COLUMN "appInstallationId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "AppWebhookHandler" ADD COLUMN "dataConnectorId" text;--> statement-breakpoint
ALTER TABLE "AppWebhookHandler" ADD CONSTRAINT "AppWebhookHandler_dataConnectorId_DataConnector_id_fk" FOREIGN KEY ("dataConnectorId") REFERENCES "public"."DataConnector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "AppWebhookHandler_connector_unique_idx" ON "AppWebhookHandler" USING btree ("dataConnectorId","handlerId") WHERE "AppWebhookHandler"."dataConnectorId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "AppWebhookHandler_dataConnectorId_idx" ON "AppWebhookHandler" USING btree ("dataConnectorId");