CREATE TABLE "RecurrenceRule" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"subjectType" text NOT NULL,
	"subjectId" text NOT NULL,
	"pattern" jsonb NOT NULL,
	"timezone" text NOT NULL,
	"anchor" date NOT NULL,
	"effectiveFrom" date NOT NULL,
	"startMinute" integer,
	"durationMinutes" integer,
	"defaultAssigneeUserId" text,
	"materializedUntil" timestamp (3) with time zone,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" ADD COLUMN "recurrenceRuleId" text;--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" ADD COLUMN "occurrenceDate" date;--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" ADD COLUMN "isDetached" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "RecurrenceRule" ADD CONSTRAINT "RecurrenceRule_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecurrenceRule" ADD CONSTRAINT "RecurrenceRule_subjectId_EntityInstance_id_fk" FOREIGN KEY ("subjectId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecurrenceRule" ADD CONSTRAINT "RecurrenceRule_defaultAssigneeUserId_User_id_fk" FOREIGN KEY ("defaultAssigneeUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "RecurrenceRule_subjectType_subjectId_key" ON "RecurrenceRule" USING btree ("subjectType","subjectId");--> statement-breakpoint
CREATE INDEX "RecurrenceRule_organizationId_subjectType_idx" ON "RecurrenceRule" USING btree ("organizationId","subjectType");--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" ADD CONSTRAINT "WorkOrderVisit_recurrenceRuleId_RecurrenceRule_id_fk" FOREIGN KEY ("recurrenceRuleId") REFERENCES "public"."RecurrenceRule"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "WorkOrderVisit_recurrenceRuleId_occurrenceDate_key" ON "WorkOrderVisit" USING btree ("recurrenceRuleId","occurrenceDate") WHERE "WorkOrderVisit"."recurrenceRuleId" IS NOT NULL;