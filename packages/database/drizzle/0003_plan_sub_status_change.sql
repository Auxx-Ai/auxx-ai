ALTER TABLE "PlanSubscription" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "PlanSubscription" ALTER COLUMN "status" SET DEFAULT 'incomplete';--> statement-breakpoint
DROP TYPE "public"."SubscriptionStatus";