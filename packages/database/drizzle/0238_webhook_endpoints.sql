CREATE TABLE "WebhookEndpoint" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"verification" text DEFAULT 'hmac' NOT NULL,
	"secret" text,
	"signatureHeader" text,
	"signaturePrefix" text,
	"topicSource" jsonb,
	"lastEventAt" timestamp (3),
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "AgentTrigger_orgId_webhook_idx";--> statement-breakpoint
DROP INDEX "Workflow_orgId_webhookTrigger_idx";--> statement-breakpoint
ALTER TABLE "AgentTrigger" ADD COLUMN "triggerWebhookEndpointId" text;--> statement-breakpoint
ALTER TABLE "Workflow" ADD COLUMN "triggerWebhookEndpointId" text;--> statement-breakpoint
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "WebhookEndpoint_organizationId_idx" ON "WebhookEndpoint" USING btree ("organizationId");--> statement-breakpoint
ALTER TABLE "AgentTrigger" ADD CONSTRAINT "AgentTrigger_triggerWebhookEndpointId_WebhookEndpoint_id_fk" FOREIGN KEY ("triggerWebhookEndpointId") REFERENCES "public"."WebhookEndpoint"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_triggerWebhookEndpointId_WebhookEndpoint_id_fk" FOREIGN KEY ("triggerWebhookEndpointId") REFERENCES "public"."WebhookEndpoint"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AgentTrigger_orgId_webhook_idx" ON "AgentTrigger" USING btree ("organizationId","enabled","triggerWebhookEndpointId","triggerTopic");--> statement-breakpoint
CREATE INDEX "Workflow_orgId_webhookTrigger_idx" ON "Workflow" USING btree ("organizationId","triggerWebhookEndpointId","triggerTopic");