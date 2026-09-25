ALTER TABLE "DataConnectorRun" ADD COLUMN "query" jsonb;--> statement-breakpoint
ALTER TABLE "DataConnectorRun" DROP COLUMN "recordFilter";