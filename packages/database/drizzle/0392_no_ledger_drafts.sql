-- Hand-added (91 §8.10): drafts are discarded, never promoted; ::text because a fresh DB adds these enum values in the same transaction.
DELETE FROM "ExportBatchPosting" WHERE "glPostingId" IN (SELECT "id" FROM "GlPosting" WHERE "status"::text = 'draft' OR "postingType"::text = 'deposit_application');--> statement-breakpoint
DELETE FROM "GlPosting" WHERE "postingType"::text = 'deposit_application' AND "reversesId" IS NOT NULL;--> statement-breakpoint
DELETE FROM "GlPosting" WHERE "status"::text = 'draft' OR "postingType"::text = 'deposit_application';--> statement-breakpoint
DELETE FROM "GlPostingSource" WHERE "linkRole" = 'pending';--> statement-breakpoint
UPDATE "GlPosting" SET "postedAt" = "createdAt" WHERE "postedAt" IS NULL;--> statement-breakpoint
ALTER TABLE "GlPosting" DROP CONSTRAINT "GlPosting_posted_check";--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "status" SET DEFAULT 'posted'::text;--> statement-breakpoint
DROP TYPE "public"."GlPostingStatus";--> statement-breakpoint
CREATE TYPE "public"."GlPostingStatus" AS ENUM('posted', 'reversed');--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "status" SET DEFAULT 'posted'::"public"."GlPostingStatus";--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "status" SET DATA TYPE "public"."GlPostingStatus" USING "status"::"public"."GlPostingStatus";--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "postingType" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."GlPostingType";--> statement-breakpoint
CREATE TYPE "public"."GlPostingType" AS ENUM('fulfillment', 'payout', 'month_end_deferral', 'month_end_reversal', 'inventory_movement', 'vendor_bill', 'manual_journal', 'opening_balance', 'bank_transaction', 'bank_deposit', 'write_off', 'payment', 'refund', 'invoice_issued', 'credit_memo', 'provider_sync', 'recurring_journal', 'vendor_credit', 'landed_cost_clear', 'vendor_payment', 'vendor_refund');--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "postingType" SET DATA TYPE "public"."GlPostingType" USING "postingType"::"public"."GlPostingType";--> statement-breakpoint
ALTER TABLE "GlPosting" ADD CONSTRAINT "GlPosting_posted_check" CHECK ("GlPosting"."postedAt" IS NOT NULL);