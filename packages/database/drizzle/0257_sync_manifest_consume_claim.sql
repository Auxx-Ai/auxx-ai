ALTER TABLE "DataConnectorRun" ADD COLUMN "manifestConsumedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "ImportJob" ADD COLUMN "manifest" jsonb;--> statement-breakpoint
ALTER TABLE "ImportJob" ADD COLUMN "manifestConsumedAt" timestamp (3);