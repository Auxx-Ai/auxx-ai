CREATE TABLE "AgentVersion" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"agentId" text NOT NULL,
	"versionNumber" integer NOT NULL,
	"label" text,
	"prompt" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"toolsets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"knowledge" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"appAccounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"toolRestrictions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"modelId" text,
	"configHash" text NOT NULL,
	"editorId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Agent" ADD COLUMN "activeVersionId" text;--> statement-breakpoint
ALTER TABLE "Agent" ADD COLUMN "hasUnpublishedChanges" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_editorId_User_id_fk" FOREIGN KEY ("editorId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AgentVersion_agentId_idx" ON "AgentVersion" USING btree ("agentId");--> statement-breakpoint
CREATE UNIQUE INDEX "AgentVersion_agentId_versionNumber_key" ON "AgentVersion" USING btree ("agentId","versionNumber");