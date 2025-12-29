CREATE TABLE "AdminActionLog" (
	"id" text PRIMARY KEY NOT NULL,
	"adminUserId" text NOT NULL,
	"actionType" text NOT NULL,
	"targetType" text NOT NULL,
	"targetId" text NOT NULL,
	"organizationId" text,
	"details" jsonb,
	"reason" text,
	"previousState" jsonb,
	"newState" jsonb,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Organization" ADD COLUMN "disabledAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Organization" ADD COLUMN "disabledReason" text;--> statement-breakpoint
ALTER TABLE "Organization" ADD COLUMN "disabledBy" text;--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "customFeatureLimits" jsonb;--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "customPricingMonthly" integer;--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "customPricingAnnual" integer;--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "customPricingNotes" text;--> statement-breakpoint
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_adminUserId_User_id_fk" FOREIGN KEY ("adminUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AdminActionLog_organizationId_idx" ON "AdminActionLog" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "AdminActionLog_adminUserId_idx" ON "AdminActionLog" USING btree ("adminUserId");--> statement-breakpoint
CREATE INDEX "AdminActionLog_createdAt_idx" ON "AdminActionLog" USING btree ("createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "AdminActionLog_actionType_idx" ON "AdminActionLog" USING btree ("actionType");