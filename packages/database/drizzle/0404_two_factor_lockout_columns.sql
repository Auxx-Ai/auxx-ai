ALTER TABLE "TwoFactor" ADD COLUMN "verified" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "TwoFactor" ADD COLUMN "failedVerificationCount" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "TwoFactor" ADD COLUMN "lockedUntil" timestamp (3);