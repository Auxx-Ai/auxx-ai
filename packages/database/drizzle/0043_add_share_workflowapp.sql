CREATE TYPE "public"."WorkflowShareAccessMode" AS ENUM('public', 'organization', 'api_key');--> statement-breakpoint
ALTER TYPE "public"."WorkflowTriggerSource" ADD VALUE 'PUBLIC_SHARE';--> statement-breakpoint
ALTER TYPE "public"."WorkflowTriggerSource" ADD VALUE 'API_KEY';--> statement-breakpoint
ALTER TYPE "public"."WorkflowTriggerSource" ADD VALUE 'WEBHOOK';--> statement-breakpoint
CREATE TABLE "EndUser" (
	"id" text PRIMARY KEY NOT NULL,
	"workflowAppId" text NOT NULL,
	"sessionId" text NOT NULL,
	"userId" text,
	"externalId" text,
	"context" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"totalRuns" integer DEFAULT 0 NOT NULL,
	"lastRunAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ApiKey" ADD COLUMN "type" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "ApiKey" ADD COLUMN "referenceId" text;--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD COLUMN "shareToken" text;--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD COLUMN "shareEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD COLUMN "icon" jsonb;--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD COLUMN "accessMode" "WorkflowShareAccessMode" DEFAULT 'public';--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD COLUMN "rateLimit" jsonb;--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD COLUMN "totalRuns" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD COLUMN "lastRunAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "WorkflowRun" ADD COLUMN "endUserId" text;--> statement-breakpoint
ALTER TABLE "EndUser" ADD CONSTRAINT "EndUser_workflowAppId_WorkflowApp_id_fk" FOREIGN KEY ("workflowAppId") REFERENCES "public"."WorkflowApp"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EndUser" ADD CONSTRAINT "EndUser_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "EndUser_workflowAppId_idx" ON "EndUser" USING btree ("workflowAppId");--> statement-breakpoint
CREATE INDEX "EndUser_sessionId_idx" ON "EndUser" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "EndUser_userId_idx" ON "EndUser" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "EndUser_workflowAppId_sessionId_idx" ON "EndUser" USING btree ("workflowAppId","sessionId");--> statement-breakpoint
CREATE INDEX "EndUser_workflowAppId_userId_idx" ON "EndUser" USING btree ("workflowAppId","userId");--> statement-breakpoint
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_endUserId_EndUser_id_fk" FOREIGN KEY ("endUserId") REFERENCES "public"."EndUser"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ApiKey_type_referenceId_idx" ON "ApiKey" USING btree ("type","referenceId");--> statement-breakpoint
CREATE UNIQUE INDEX "WorkflowApp_shareToken_key" ON "WorkflowApp" USING btree ("shareToken");--> statement-breakpoint
CREATE INDEX "WorkflowApp_shareEnabled_idx" ON "WorkflowApp" USING btree ("shareEnabled");--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD CONSTRAINT "WorkflowApp_shareToken_unique" UNIQUE("shareToken");