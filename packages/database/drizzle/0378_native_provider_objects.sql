ALTER TABLE "FinancialSourceAccount" ADD COLUMN "exportShape" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "FinancialSourceAccount" ADD COLUMN "providerCustomerRef" jsonb;