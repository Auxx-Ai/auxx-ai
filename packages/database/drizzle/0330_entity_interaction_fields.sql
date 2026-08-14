ALTER TABLE "EntityInstance" ADD COLUMN "firstInteractionAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD COLUMN "firstInteractionMessageId" text;--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD COLUMN "lastInteractionAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD COLUMN "lastInteractionMessageId" text;--> statement-breakpoint
CREATE INDEX "EntityInstance_organizationId_entityDefinitionId_lastInteractionAt_idx" ON "EntityInstance" USING btree ("organizationId","entityDefinitionId","lastInteractionAt");