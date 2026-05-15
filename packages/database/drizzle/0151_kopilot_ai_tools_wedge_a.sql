ALTER TABLE "AppDeployment" ADD COLUMN "aiTools" jsonb;--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD COLUMN "integrationSource" text;--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD COLUMN "externalId" text;--> statement-breakpoint
CREATE INDEX "EntityInstance_integrationLookup_idx" ON "EntityInstance" USING btree ("organizationId","entityDefinitionId","integrationSource","externalId");