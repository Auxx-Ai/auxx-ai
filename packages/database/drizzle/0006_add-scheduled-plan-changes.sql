CREATE TABLE "PlanSubscriptionHistory" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriptionId" text NOT NULL,
	"organizationId" text NOT NULL,
	"changeType" text NOT NULL,
	"fromPlan" text,
	"toPlan" text,
	"fromBillingCycle" "BillingCycle",
	"toBillingCycle" "BillingCycle",
	"fromSeats" integer,
	"toSeats" integer,
	"immediate" boolean NOT NULL,
	"scheduledFor" timestamp (3),
	"appliedAt" timestamp (3),
	"prorationAmount" integer,
	"userId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "scheduledPlanId" text;--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "scheduledPlan" text;--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "scheduledBillingCycle" "BillingCycle";--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "scheduledSeats" integer;--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "scheduledChangeAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD CONSTRAINT "PlanSubscription_scheduledPlanId_Plan_id_fk" FOREIGN KEY ("scheduledPlanId") REFERENCES "public"."Plan"("id") ON DELETE set null ON UPDATE cascade;