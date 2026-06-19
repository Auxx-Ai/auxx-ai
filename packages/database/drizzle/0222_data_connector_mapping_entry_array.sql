ALTER TABLE "DataConnectorMapping" ALTER COLUMN "fieldMappings" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "DataConnectorMapping" DROP COLUMN "mergeStrategies";