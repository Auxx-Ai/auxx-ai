ALTER TABLE "DataConnectorRun" ADD COLUMN "integrityPendingSince" timestamp (3);--> statement-breakpoint
ALTER TABLE "ImportJob" ADD COLUMN "integrityPendingSince" timestamp (3);