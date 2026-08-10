ALTER TABLE "PlanSubscription" ADD COLUMN "adminOverrideAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "adminOverrideReason" text;