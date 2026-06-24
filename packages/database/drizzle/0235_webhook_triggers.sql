ALTER TABLE "AgentTrigger" ADD COLUMN "triggerTopic" text;--> statement-breakpoint
ALTER TABLE "Workflow" ADD COLUMN "triggerTopic" text;--> statement-breakpoint
CREATE INDEX "AgentTrigger_orgId_webhook_idx" ON "AgentTrigger" USING btree ("organizationId","enabled","triggerConnectionId","triggerTopic");--> statement-breakpoint
CREATE UNIQUE INDEX "AppWebhookHandler_connection_unique_idx" ON "AppWebhookHandler" USING btree ("connectionId","handlerId") WHERE "AppWebhookHandler"."appInstallationId" IS NULL AND "AppWebhookHandler"."dataConnectorId" IS NULL AND "AppWebhookHandler"."connectionId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "Workflow_orgId_webhookTrigger_idx" ON "Workflow" USING btree ("organizationId","triggerConnectionId","triggerTopic");