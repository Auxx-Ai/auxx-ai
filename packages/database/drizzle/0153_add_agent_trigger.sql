CREATE TABLE "AgentTrigger" (
	"id" text PRIMARY KEY NOT NULL,
	"agentId" text NOT NULL,
	"organizationId" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"triggerType" text,
	"entityDefinitionId" text,
	"eventType" text,
	"triggerAppId" text,
	"triggerAppTriggerId" text,
	"triggerInstallationId" text,
	"triggerConnectionId" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"instructions" jsonb,
	"lastFiredAt" timestamp (3),
	"lastErrorAt" timestamp (3),
	"lastError" text,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AiAgentSession" ADD COLUMN "agentTriggerId" text;--> statement-breakpoint
ALTER TABLE "AiAgentSession" ADD COLUMN "triggerContext" jsonb;--> statement-breakpoint
ALTER TABLE "AgentTrigger" ADD CONSTRAINT "AgentTrigger_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AgentTrigger" ADD CONSTRAINT "AgentTrigger_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AgentTrigger" ADD CONSTRAINT "AgentTrigger_triggerInstallationId_AppInstallation_id_fk" FOREIGN KEY ("triggerInstallationId") REFERENCES "public"."AppInstallation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AgentTrigger" ADD CONSTRAINT "AgentTrigger_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AgentTrigger_agentId_idx" ON "AgentTrigger" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "AgentTrigger_orgId_event_crud_idx" ON "AgentTrigger" USING btree ("organizationId","enabled","entityDefinitionId","triggerType");--> statement-breakpoint
CREATE INDEX "AgentTrigger_orgId_event_direct_idx" ON "AgentTrigger" USING btree ("organizationId","enabled","eventType");--> statement-breakpoint
CREATE INDEX "AgentTrigger_orgId_app_idx" ON "AgentTrigger" USING btree ("organizationId","enabled","triggerAppId","triggerAppTriggerId","triggerInstallationId");--> statement-breakpoint
CREATE INDEX "AgentTrigger_orgId_kind_enabled_idx" ON "AgentTrigger" USING btree ("organizationId","kind","enabled");--> statement-breakpoint
ALTER TABLE "AiAgentSession" ADD CONSTRAINT "AiAgentSession_agentTriggerId_AgentTrigger_id_fk" FOREIGN KEY ("agentTriggerId") REFERENCES "public"."AgentTrigger"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AiAgentSession_agentTriggerId_updatedAt_idx" ON "AiAgentSession" USING btree ("agentTriggerId","updatedAt" DESC NULLS LAST);