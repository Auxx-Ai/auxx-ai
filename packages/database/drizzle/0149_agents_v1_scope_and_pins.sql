CREATE TYPE "public"."AgentResourceScopeMode" AS ENUM('include_descendants', 'include_one', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."AgentResourceScopeSource" AS ENUM('manual', 'mention', 'auto_default');--> statement-breakpoint
CREATE TYPE "public"."AgentToolsetSource" AS ENUM('manual', 'mention', 'auto_default');--> statement-breakpoint
ALTER TYPE "public"."UserType" ADD VALUE 'AGENT';--> statement-breakpoint
CREATE TABLE "AgentResourceScope" (
	"id" text PRIMARY KEY NOT NULL,
	"agentId" text NOT NULL,
	"organizationId" text NOT NULL,
	"entityDefinitionId" text NOT NULL,
	"entityInstanceId" text,
	"mode" "AgentResourceScopeMode" NOT NULL,
	"source" "AgentResourceScopeSource" DEFAULT 'manual' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AgentToolset" (
	"id" text PRIMARY KEY NOT NULL,
	"agentId" text NOT NULL,
	"toolsetSlug" text NOT NULL,
	"appInstallationId" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" "AgentToolsetSource" DEFAULT 'manual' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Agent" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"createdById" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"avatar" text,
	"prompt" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pinnedRecords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mentionable" boolean DEFAULT true NOT NULL,
	"modelId" text,
	"archivedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "Agent_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
ALTER TABLE "AiAgentSession" ADD COLUMN "agentId" text;--> statement-breakpoint
ALTER TABLE "AgentResourceScope" ADD CONSTRAINT "AgentResourceScope_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AgentResourceScope" ADD CONSTRAINT "AgentResourceScope_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AgentToolset" ADD CONSTRAINT "AgentToolset_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "AgentResourceScope_agent_def_instance_idx" ON "AgentResourceScope" USING btree ("agentId","entityDefinitionId","entityInstanceId");--> statement-breakpoint
CREATE INDEX "AgentResourceScope_agentId_mode_idx" ON "AgentResourceScope" USING btree ("agentId","mode");--> statement-breakpoint
CREATE INDEX "AgentResourceScope_org_def_idx" ON "AgentResourceScope" USING btree ("organizationId","entityDefinitionId");--> statement-breakpoint
CREATE INDEX "AgentResourceScope_org_def_instance_idx" ON "AgentResourceScope" USING btree ("organizationId","entityDefinitionId","entityInstanceId");--> statement-breakpoint
CREATE UNIQUE INDEX "AgentToolset_agentId_slug_idx" ON "AgentToolset" USING btree ("agentId","toolsetSlug");--> statement-breakpoint
CREATE INDEX "AgentToolset_agentId_enabled_idx" ON "AgentToolset" USING btree ("agentId","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "Agent_organizationId_slug_idx" ON "Agent" USING btree ("organizationId","slug");--> statement-breakpoint
CREATE INDEX "Agent_organizationId_idx" ON "Agent" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Agent_createdById_idx" ON "Agent" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "Agent_organizationId_archivedAt_idx" ON "Agent" USING btree ("organizationId","archivedAt");--> statement-breakpoint
CREATE INDEX "Agent_userId_idx" ON "Agent" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "AiAgentSession" ADD CONSTRAINT "AiAgentSession_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AiAgentSession_agentId_updatedAt_idx" ON "AiAgentSession" USING btree ("agentId","updatedAt" DESC NULLS LAST);