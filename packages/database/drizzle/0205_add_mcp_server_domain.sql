CREATE TABLE "McpInstallation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"mcpServerId" text NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"serverInfo" jsonb,
	"protocolVersion" text,
	"trust" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lastSyncedAt" timestamp (3),
	"lastSyncError" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "McpServer" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"iconUrl" text,
	"endpoint" text NOT NULL,
	"authDiscovery" jsonb,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ConnectionDefinition" ALTER COLUMN "developerAccountId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ConnectionDefinition" ALTER COLUMN "appId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ConnectionDefinition" ADD COLUMN "mcpServerId" text;--> statement-breakpoint
ALTER TABLE "WorkflowCredentials" ADD COLUMN "mcpServerId" text;--> statement-breakpoint
ALTER TABLE "McpInstallation" ADD CONSTRAINT "McpInstallation_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "McpInstallation" ADD CONSTRAINT "McpInstallation_mcpServerId_McpServer_id_fk" FOREIGN KEY ("mcpServerId") REFERENCES "public"."McpServer"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "McpServer" ADD CONSTRAINT "McpServer_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "McpInstallation_org_server_idx" ON "McpInstallation" USING btree ("organizationId","mcpServerId");--> statement-breakpoint
CREATE UNIQUE INDEX "McpServer_org_slug_idx" ON "McpServer" USING btree ("organizationId","slug");--> statement-breakpoint
CREATE INDEX "McpServer_org_idx" ON "McpServer" USING btree ("organizationId");--> statement-breakpoint
ALTER TABLE "ConnectionDefinition" ADD CONSTRAINT "ConnectionDefinition_mcpServerId_McpServer_id_fk" FOREIGN KEY ("mcpServerId") REFERENCES "public"."McpServer"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkflowCredentials" ADD CONSTRAINT "WorkflowCredentials_mcpServerId_McpServer_id_fk" FOREIGN KEY ("mcpServerId") REFERENCES "public"."McpServer"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ConnectionDefinition_mcpServerId_idx" ON "ConnectionDefinition" USING btree ("mcpServerId");--> statement-breakpoint
CREATE INDEX "WorkflowCredentials_mcpServerId_idx" ON "WorkflowCredentials" USING btree ("mcpServerId","organizationId");--> statement-breakpoint
ALTER TABLE "ConnectionDefinition" ADD CONSTRAINT "ConnectionDefinition_owner_check" CHECK ((("appId" IS NOT NULL)::int + ("mcpServerId" IS NOT NULL)::int) = 1);