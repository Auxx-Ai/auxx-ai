ALTER TABLE "GlPosting" ALTER COLUMN "postingType" SET DATA TYPE text;--> statement-breakpoint
-- 73 D3: one record, one posting type. Hand-added to the generated diff - without
-- it the cast below fails on any bill posted under the old type.
UPDATE "GlPosting" SET "postingType" = 'vendor_bill' WHERE "postingType" = 'expense_bill';--> statement-breakpoint
DROP TYPE "public"."GlPostingType";--> statement-breakpoint
CREATE TYPE "public"."GlPostingType" AS ENUM('fulfillment', 'payout', 'month_end_deferral', 'month_end_reversal', 'inventory_movement', 'vendor_bill', 'manual_journal', 'opening_balance', 'bank_transaction', 'bank_deposit', 'write_off', 'payment', 'refund', 'invoice_issued', 'deposit_application', 'credit_memo', 'provider_sync', 'recurring_journal', 'vendor_credit');--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "postingType" SET DATA TYPE "public"."GlPostingType" USING "postingType"::"public"."GlPostingType";