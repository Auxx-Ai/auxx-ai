ALTER TYPE "public"."ApprovalKind" ADD VALUE 'bulk-dispatch';--> statement-breakpoint
ALTER TABLE "DataConnectorRun" ADD COLUMN "heldDispatches" jsonb;--> statement-breakpoint
ALTER TABLE "ImportJob" ADD COLUMN "heldDispatches" jsonb;