DROP INDEX "Workflow_organizationId_triggerType_idx";--> statement-breakpoint
ALTER TABLE "Workflow" ADD COLUMN "entityDefinitionId" text;--> statement-breakpoint
CREATE INDEX "Workflow_orgId_triggerType_entityDefId_idx" ON "Workflow" USING btree ("organizationId","triggerType","entityDefinitionId");--> statement-breakpoint
ALTER TABLE "Workflow" DROP COLUMN "triggerConfig";