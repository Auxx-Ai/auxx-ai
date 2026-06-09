CREATE TYPE "public"."EvalKind" AS ENUM('agent_simulation', 'workflow', 'recorded_ticket');--> statement-breakpoint
CREATE TYPE "public"."EvalRunStatus" AS ENUM('queued', 'running', 'passed', 'failed', 'error', 'cancelled', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."EvalSuiteRunStatus" AS ENUM('queued', 'running', 'completed', 'cancelled', 'error');--> statement-breakpoint
CREATE TABLE "EvalCase" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"kind" "EvalKind" NOT NULL,
	"target" jsonb NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"assertions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agentId" text,
	"procedureId" text,
	"suggestionId" text,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "EvalRun" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"caseId" text,
	"suiteRunId" text,
	"kind" "EvalKind" NOT NULL,
	"status" "EvalRunStatus" NOT NULL,
	"definitionSnapshot" jsonb NOT NULL,
	"runtimeSnapshot" jsonb NOT NULL,
	"snapshotHash" text NOT NULL,
	"traceVersion" integer DEFAULT 1 NOT NULL,
	"trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lastTraceSequence" integer DEFAULT 0 NOT NULL,
	"assertionResults" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"startedAt" timestamp (3),
	"heartbeatAt" timestamp (3),
	"completedAt" timestamp (3),
	"errorCode" text,
	"error" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "EvalSuiteRun" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"kind" "EvalKind" NOT NULL,
	"status" "EvalSuiteRunStatus" NOT NULL,
	"requestedCount" integer DEFAULT 0 NOT NULL,
	"completedCount" integer DEFAULT 0 NOT NULL,
	"passedCount" integer DEFAULT 0 NOT NULL,
	"failedCount" integer DEFAULT 0 NOT NULL,
	"errorCount" integer DEFAULT 0 NOT NULL,
	"cancelledCount" integer DEFAULT 0 NOT NULL,
	"timedOutCount" integer DEFAULT 0 NOT NULL,
	"selectionSnapshot" jsonb NOT NULL,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"startedAt" timestamp (3),
	"completedAt" timestamp (3)
);
--> statement-breakpoint
ALTER TABLE "EvalCase" ADD CONSTRAINT "EvalCase_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EvalCase" ADD CONSTRAINT "EvalCase_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EvalCase" ADD CONSTRAINT "EvalCase_procedureId_Procedure_id_fk" FOREIGN KEY ("procedureId") REFERENCES "public"."Procedure"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EvalCase" ADD CONSTRAINT "EvalCase_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EvalRun" ADD CONSTRAINT "EvalRun_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EvalRun" ADD CONSTRAINT "EvalRun_caseId_EvalCase_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."EvalCase"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EvalRun" ADD CONSTRAINT "EvalRun_suiteRunId_EvalSuiteRun_id_fk" FOREIGN KEY ("suiteRunId") REFERENCES "public"."EvalSuiteRun"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EvalSuiteRun" ADD CONSTRAINT "EvalSuiteRun_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EvalSuiteRun" ADD CONSTRAINT "EvalSuiteRun_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "EvalCase_organizationId_idx" ON "EvalCase" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "EvalCase_kind_idx" ON "EvalCase" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "EvalCase_agentId_procedureId_idx" ON "EvalCase" USING btree ("agentId","procedureId");--> statement-breakpoint
CREATE INDEX "EvalRun_caseId_createdAt_idx" ON "EvalRun" USING btree ("caseId","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "EvalRun_suiteRunId_idx" ON "EvalRun" USING btree ("suiteRunId");--> statement-breakpoint
CREATE INDEX "EvalRun_organizationId_createdAt_idx" ON "EvalRun" USING btree ("organizationId","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "EvalRun_status_heartbeatAt_idx" ON "EvalRun" USING btree ("status","heartbeatAt");--> statement-breakpoint
CREATE INDEX "EvalSuiteRun_organizationId_createdAt_idx" ON "EvalSuiteRun" USING btree ("organizationId","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "EvalSuiteRun_status_idx" ON "EvalSuiteRun" USING btree ("status");