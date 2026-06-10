ALTER TABLE "EvalRun" ADD COLUMN "runMode" text DEFAULT 'pinned' NOT NULL;--> statement-breakpoint
ALTER TABLE "EvalSuiteRun" ADD COLUMN "runMode" text DEFAULT 'pinned' NOT NULL;--> statement-breakpoint
ALTER TABLE "EvalSuiteRun" ADD COLUMN "draftContentHash" text;--> statement-breakpoint
ALTER TABLE "EvalSuiteRun" ADD COLUMN "baselineSuiteRunId" text;--> statement-breakpoint
ALTER TABLE "EvalSuiteRun" ADD COLUMN "agentId" text;--> statement-breakpoint
ALTER TABLE "EvalSuiteRun" ADD COLUMN "procedureId" text;--> statement-breakpoint
ALTER TABLE "EvalSuiteRun" ADD CONSTRAINT "EvalSuiteRun_baselineSuiteRunId_EvalSuiteRun_id_fk" FOREIGN KEY ("baselineSuiteRunId") REFERENCES "public"."EvalSuiteRun"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "EvalSuiteRun_agentId_createdAt_idx" ON "EvalSuiteRun" USING btree ("agentId","createdAt" DESC NULLS LAST);