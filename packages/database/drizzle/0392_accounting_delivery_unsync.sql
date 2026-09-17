ALTER TABLE "AccountingDelivery" ADD COLUMN "attemptEpoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ExternalAccountingObject" ADD COLUMN "withdrawnAt" timestamp with time zone;