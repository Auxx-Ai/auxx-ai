ALTER TABLE "DataConnectorRun" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "DataConnectorRun" ADD COLUMN "pagesProcessed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "DataConnectorRun" ADD COLUMN "rateLimitWaitMs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "DataConnectorRun" ADD COLUMN "progress" jsonb;--> statement-breakpoint
ALTER TABLE "DataConnectorRun" ADD COLUMN "heartbeatAt" timestamp (3) DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "DataConnectorRun_status_heartbeatAt_idx" ON "DataConnectorRun" USING btree ("status","heartbeatAt");