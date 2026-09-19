ALTER TABLE "MoneyTransaction" ADD COLUMN "postingBlockedReason" text;--> statement-breakpoint
ALTER TABLE "MoneyTransaction" ADD COLUMN "postingBlockedAt" timestamp with time zone;