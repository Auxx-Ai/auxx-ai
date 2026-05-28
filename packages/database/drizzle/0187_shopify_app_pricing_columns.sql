ALTER TABLE "Plan" ADD COLUMN "shopifyPlanHandle" text;--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "shopifyShopGid" text;--> statement-breakpoint
ALTER TABLE "PlanSubscription" DROP COLUMN "shopifySubscriptionGid";