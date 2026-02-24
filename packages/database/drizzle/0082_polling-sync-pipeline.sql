ALTER TYPE "public"."IntegrationSyncStage" ADD VALUE 'MESSAGE_LIST_FETCH_PENDING' BEFORE 'MESSAGE_LIST_FETCH';--> statement-breakpoint
ALTER TYPE "public"."IntegrationSyncStage" ADD VALUE 'MESSAGES_IMPORT_PENDING' BEFORE 'MESSAGES_IMPORT';--> statement-breakpoint
ALTER TABLE "Integration" ADD COLUMN "syncMode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "Integration" ADD COLUMN "pollingIntervalMs" integer DEFAULT 300000;--> statement-breakpoint
ALTER TABLE "Label" ADD COLUMN "providerCursor" text;--> statement-breakpoint
ALTER TABLE "Label" ADD COLUMN "pendingAction" text;--> statement-breakpoint
ALTER TABLE "Label" ADD COLUMN "isSentBox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Label" ADD COLUMN "parentLabelId" text;--> statement-breakpoint
ALTER TABLE "Label" ADD CONSTRAINT "Label_parentLabelId_Label_id_fk" FOREIGN KEY ("parentLabelId") REFERENCES "public"."Label"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Label_integrationId_idx" ON "Label" USING btree ("integrationId");