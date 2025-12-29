ALTER TABLE "WorkflowCredentials" ADD COLUMN "expiresAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "WorkflowCredentials" ADD COLUMN "lastTokenRefreshAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "WorkflowCredentials" ADD COLUMN "lastRefreshFailureAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "WorkflowCredentials" ADD COLUMN "consecutiveRefreshFailures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "WorkflowCredentials_expiresAt_idx" ON "WorkflowCredentials" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "WorkflowCredentials_lastTokenRefreshAt_idx" ON "WorkflowCredentials" USING btree ("lastTokenRefreshAt");