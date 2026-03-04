DROP INDEX "AppWebhookHandler_unique_idx";--> statement-breakpoint
ALTER TABLE "AppWebhookHandler" ADD COLUMN "connectionId" text;--> statement-breakpoint
ALTER TABLE "Workflow" ADD COLUMN "triggerConnectionId" text;--> statement-breakpoint
ALTER TABLE "WorkflowCredentials" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "AppWebhookHandler" ADD CONSTRAINT "AppWebhookHandler_connectionId_WorkflowCredentials_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."WorkflowCredentials"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "AppWebhookHandler_unique_idx" ON "AppWebhookHandler" USING btree ("appInstallationId","handlerId","connectionId");