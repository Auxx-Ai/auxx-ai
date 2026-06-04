CREATE TABLE "AgentProcedure" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"agentId" text NOT NULL,
	"procedureId" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"whenToUseOverride" text,
	"triggerExamplesOverride" jsonb,
	"rulesetOverride" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Procedure" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"whenToUse" text DEFAULT '' NOT NULL,
	"triggerExamples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ruleset" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draftVersionId" text,
	"activeVersionId" text,
	"hasUnpublishedChanges" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProcedureVersion" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"procedureId" text NOT NULL,
	"versionNumber" integer,
	"label" text,
	"doc" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compiled" jsonb,
	"editorId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AgentProcedure" ADD CONSTRAINT "AgentProcedure_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AgentProcedure" ADD CONSTRAINT "AgentProcedure_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AgentProcedure" ADD CONSTRAINT "AgentProcedure_procedureId_Procedure_id_fk" FOREIGN KEY ("procedureId") REFERENCES "public"."Procedure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProcedureVersion" ADD CONSTRAINT "ProcedureVersion_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProcedureVersion" ADD CONSTRAINT "ProcedureVersion_procedureId_Procedure_id_fk" FOREIGN KEY ("procedureId") REFERENCES "public"."Procedure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProcedureVersion" ADD CONSTRAINT "ProcedureVersion_editorId_User_id_fk" FOREIGN KEY ("editorId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AgentProcedure_agentId_idx" ON "AgentProcedure" USING btree ("agentId");--> statement-breakpoint
CREATE UNIQUE INDEX "AgentProcedure_agentId_procedureId_key" ON "AgentProcedure" USING btree ("agentId","procedureId");--> statement-breakpoint
CREATE INDEX "Procedure_organizationId_idx" ON "Procedure" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "ProcedureVersion_procedureId_idx" ON "ProcedureVersion" USING btree ("procedureId");--> statement-breakpoint
CREATE UNIQUE INDEX "ProcedureVersion_procedureId_versionNumber_key" ON "ProcedureVersion" USING btree ("procedureId","versionNumber" DESC NULLS LAST) WHERE "versionNumber" IS NOT NULL;