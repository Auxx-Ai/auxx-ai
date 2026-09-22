-- 92: one category per posting. The enum is recreated the way 0384 did rather
-- than ADD VALUE'd, because the migrator runs this file in one transaction and
-- Postgres refuses to USE a value added in the transaction that added it.
ALTER TABLE "GlPosting" ALTER COLUMN "postingType" SET DATA TYPE text;--> statement-breakpoint
-- A vendor payment or refund used to share the customer type. Reclassified off
-- the movement it posted from; the frozen doc number stays what the provider saw.
UPDATE "GlPosting" p SET "postingType" = 'vendor_payment'
WHERE p."postingType" = 'payment' AND EXISTS (
  SELECT 1 FROM "GlPostingSource" l
  JOIN "MoneyTransaction" m ON m."organizationId" = l."organizationId" AND m."id" = l."sourceId"
  WHERE l."organizationId" = p."organizationId" AND l."glPostingId" = p."id"
    AND l."sourceKind" = 'money_transaction' AND m."purpose" = 'vendor_payment'
);--> statement-breakpoint
UPDATE "GlPosting" p SET "postingType" = 'vendor_refund'
WHERE p."postingType" = 'refund' AND EXISTS (
  SELECT 1 FROM "GlPostingSource" l
  JOIN "MoneyTransaction" m ON m."organizationId" = l."organizationId" AND m."id" = l."sourceId"
  WHERE l."organizationId" = p."organizationId" AND l."glPostingId" = p."id"
    AND l."sourceKind" = 'money_transaction' AND m."purpose" = 'vendor_refund'
);--> statement-breakpoint
DROP TYPE "public"."GlPostingType";--> statement-breakpoint
CREATE TYPE "public"."GlPostingType" AS ENUM('fulfillment', 'payout', 'month_end_deferral', 'month_end_reversal', 'inventory_movement', 'vendor_bill', 'manual_journal', 'opening_balance', 'bank_transaction', 'bank_deposit', 'write_off', 'payment', 'refund', 'invoice_issued', 'deposit_application', 'credit_memo', 'provider_sync', 'recurring_journal', 'vendor_credit', 'landed_cost_clear', 'vendor_payment', 'vendor_refund');--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "postingType" SET DATA TYPE "public"."GlPostingType" USING "postingType"::"public"."GlPostingType";--> statement-breakpoint
ALTER TABLE "GlPosting" ADD COLUMN "avenue" text;--> statement-breakpoint
-- `avenueOfPostingType`, once, over every existing row.
UPDATE "GlPosting" SET "avenue" = CASE "postingType"
  WHEN 'fulfillment' THEN 'fulfillment'
  WHEN 'invoice_issued' THEN 'invoice'
  WHEN 'payment' THEN 'receipt'
  WHEN 'deposit_application' THEN 'receipt'
  WHEN 'refund' THEN 'refund'
  WHEN 'credit_memo' THEN 'creditMemo'
  WHEN 'vendor_bill' THEN 'expenseBill'
  WHEN 'vendor_payment' THEN 'vendorPayment'
  WHEN 'vendor_refund' THEN 'vendorPayment'
  WHEN 'vendor_credit' THEN 'vendorCredit'
  WHEN 'payout' THEN 'payout'
  WHEN 'bank_deposit' THEN 'bankDeposit'
  WHEN 'inventory_movement' THEN 'inventory'
  WHEN 'landed_cost_clear' THEN 'inventory'
  WHEN 'write_off' THEN 'journal'
  WHEN 'manual_journal' THEN 'journal'
  WHEN 'recurring_journal' THEN 'journal'
  WHEN 'month_end_deferral' THEN 'journal'
  WHEN 'month_end_reversal' THEN 'journal'
  ELSE NULL END;--> statement-breakpoint
CREATE INDEX "GlPosting_org_avenue_txnDate_idx" ON "GlPosting" USING btree ("organizationId","avenue","txnDate");--> statement-breakpoint
ALTER TABLE "GlPosting" ADD CONSTRAINT "GlPosting_avenue_check" CHECK ("GlPosting"."avenue" IS NULL OR "GlPosting"."avenue" IN ('fulfillment','invoice','receipt','refund','creditMemo','expenseBill','vendorPayment','vendorCredit','payout','bankDeposit','inventory','journal'));
