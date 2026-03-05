CREATE TABLE "PollingTriggerState" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"workflowAppId" text NOT NULL,
	"triggerId" text NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lastPollAt" timestamp (3),
	"lastPollStatus" text,
	"lastPollError" text,
	"consecutiveErrors" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PollingTriggerState" ADD CONSTRAINT "PollingTriggerState_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PollingTriggerState" ADD CONSTRAINT "PollingTriggerState_workflowAppId_WorkflowApp_id_fk" FOREIGN KEY ("workflowAppId") REFERENCES "public"."WorkflowApp"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "PollingTriggerState_workflowAppId_triggerId_key" ON "PollingTriggerState" USING btree ("workflowAppId","triggerId");--> statement-breakpoint
CREATE INDEX "PollingTriggerState_organizationId_idx" ON "PollingTriggerState" USING btree ("organizationId");