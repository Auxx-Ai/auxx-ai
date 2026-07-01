DROP INDEX "EntityInstance_integrationLookup_idx";--> statement-breakpoint
ALTER TABLE "DataConnectorItem" ADD COLUMN "mintedInstance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "EntityInstance" DROP COLUMN "integrationSource";--> statement-breakpoint
ALTER TABLE "EntityInstance" DROP COLUMN "externalId";