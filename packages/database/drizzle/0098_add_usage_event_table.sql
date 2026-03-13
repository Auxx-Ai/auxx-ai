CREATE TABLE "UsageEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text,
	"metric" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb,
	"periodKey" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "UsageEvent_org_metric_period_idx" ON "UsageEvent" USING btree ("organizationId","metric","periodKey");