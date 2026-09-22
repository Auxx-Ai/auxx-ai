CREATE TABLE "AccountingWorkItem" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"sourceKind" text NOT NULL,
	"sourceId" text NOT NULL,
	"occurrence" integer DEFAULT 0 NOT NULL,
	"stage" text NOT NULL,
	"reasonCode" text NOT NULL,
	"role" text,
	"railId" text,
	"glAccountId" text,
	"periodKey" text,
	"externalRef" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"nextAttemptAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "AccountingWorkItem_source_key" UNIQUE("organizationId","sourceKind","sourceId","occurrence","stage"),
	CONSTRAINT "AccountingWorkItem_stage_check" CHECK ("AccountingWorkItem"."stage" IN ('evidence','money','post','issue') AND "AccountingWorkItem"."attempts" >= 0 AND "AccountingWorkItem"."occurrence" >= 0)
);
--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" DROP CONSTRAINT "FinancialSourceAcceptance_state_check";--> statement-breakpoint
DROP INDEX "FinancialSourceAcceptance_recovery_idx";--> statement-breakpoint
ALTER TABLE "AccountingWorkItem" ADD CONSTRAINT "AccountingWorkItem_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AccountingWorkItem_reason_idx" ON "AccountingWorkItem" USING btree ("organizationId","reasonCode");--> statement-breakpoint
CREATE INDEX "AccountingWorkItem_due_idx" ON "AccountingWorkItem" USING btree ("organizationId","nextAttemptAt");--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" DROP COLUMN "reason";--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" DROP COLUMN "attempts";--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" DROP COLUMN "nextAttemptAt";--> statement-breakpoint
ALTER TABLE "FinancialSourceAccount" DROP COLUMN "exportShape";--> statement-breakpoint
ALTER TABLE "MoneyTransaction" DROP COLUMN "postingBlockedReason";--> statement-breakpoint
ALTER TABLE "MoneyTransaction" DROP COLUMN "postingBlockedAt";--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" ADD CONSTRAINT "FinancialSourceAcceptance_state_check" CHECK ("FinancialSourceAcceptance"."state" IN ('pending','accepted','rejected','blocked'));