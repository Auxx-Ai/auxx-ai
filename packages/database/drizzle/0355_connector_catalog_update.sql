ALTER TABLE "DataConnectorMapping" ADD COLUMN "catalogHash" text;--> statement-breakpoint
ALTER TABLE "DataConnectorStream" ADD COLUMN "catalogHash" text;--> statement-breakpoint
ALTER TABLE "DataConnector" ADD COLUMN "catalogDeploymentId" text;--> statement-breakpoint
ALTER TABLE "DataConnector" ADD CONSTRAINT "DataConnector_catalogDeploymentId_AppDeployment_id_fk" FOREIGN KEY ("catalogDeploymentId") REFERENCES "public"."AppDeployment"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
-- Backfill (task 41 section 4): an existing app connector is assumed to have been seeded
-- from its installation's current deployment. The best available guess; rows it cannot
-- prove unedited are handled by the D5 comparison at read time.
UPDATE "DataConnector" dc
SET "catalogDeploymentId" = ai."currentDeploymentId"
FROM "AppInstallation" ai
WHERE ai."id" = dc."appInstallationId"
  AND dc."catalogDeploymentId" IS NULL
  AND ai."currentDeploymentId" IS NOT NULL;
