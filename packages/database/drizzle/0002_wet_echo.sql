ALTER TABLE "PaymentMethod" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "PaymentMethod" CASCADE;--> statement-breakpoint
ALTER TABLE "PlanSubscription" RENAME COLUMN "currentPeriodStart" TO "periodStart";--> statement-breakpoint
ALTER TABLE "PlanSubscription" RENAME COLUMN "currentPeriodEnd" TO "periodEnd";--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "plan" text NOT NULL;--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "cancelAtPeriodEnd" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "PlanSubscription" DROP COLUMN "startDate";--> statement-breakpoint
ALTER TABLE "PlanSubscription" DROP COLUMN "paymentMethodId";--> statement-breakpoint
