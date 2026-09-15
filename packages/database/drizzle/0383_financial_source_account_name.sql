ALTER TABLE "FinancialSourceAccount" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "FinancialSourceAccount" ADD COLUMN "axis" text;--> statement-breakpoint
ALTER TABLE "FinancialSourceAccount" ADD CONSTRAINT "FinancialSourceAccount_axis_check" CHECK ("FinancialSourceAccount"."axis" IS NULL OR "FinancialSourceAccount"."axis" IN ('store', 'processor', 'both'));