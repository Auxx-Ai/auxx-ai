ALTER TYPE "public"."GlPostingType" ADD VALUE 'manual_journal';--> statement-breakpoint
ALTER TYPE "public"."GlPostingType" ADD VALUE 'opening_balance';--> statement-breakpoint
ALTER TYPE "public"."GlPostingType" ADD VALUE 'bank_transaction';--> statement-breakpoint
ALTER TYPE "public"."GlPostingType" ADD VALUE 'bank_deposit';--> statement-breakpoint
ALTER TYPE "public"."GlPostingType" ADD VALUE 'write_off';--> statement-breakpoint
ALTER TYPE "public"."GlPostingType" ADD VALUE 'payment';--> statement-breakpoint
ALTER TABLE "GlPostingLine" ADD COLUMN "dimensions" jsonb;