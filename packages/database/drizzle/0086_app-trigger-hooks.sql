ALTER TABLE "AppWebhookHandler" ADD COLUMN "triggerId" text;--> statement-breakpoint
ALTER TABLE "Workflow" ADD COLUMN "triggerAppId" text;--> statement-breakpoint
ALTER TABLE "Workflow" ADD COLUMN "triggerTriggerId" text;--> statement-breakpoint
ALTER TABLE "Workflow" ADD COLUMN "triggerInstallationId" text;--> statement-breakpoint
CREATE INDEX "Workflow_orgId_appTrigger_idx" ON "Workflow" USING btree ("organizationId","triggerAppId","triggerTriggerId","triggerInstallationId");