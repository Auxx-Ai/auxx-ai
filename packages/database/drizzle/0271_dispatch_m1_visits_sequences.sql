CREATE TABLE "WorkOrderVisit" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"workOrderId" text NOT NULL,
	"assigneeUserId" text,
	"startTime" timestamp (3) with time zone,
	"endTime" timestamp (3) with time zone,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"routeOrder" integer,
	"latitude" double precision,
	"longitude" double precision,
	"geocodedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "TicketSequence" RENAME TO "RecordSequence";--> statement-breakpoint
ALTER TABLE "RecordSequence" DROP CONSTRAINT "TicketSequence_organizationId_Organization_id_fk";
--> statement-breakpoint
DROP INDEX "TicketSequence_organizationId_key";--> statement-breakpoint
ALTER TABLE "RecordSequence" ADD COLUMN "scope" text DEFAULT 'ticket' NOT NULL;--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" ADD CONSTRAINT "WorkOrderVisit_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" ADD CONSTRAINT "WorkOrderVisit_workOrderId_EntityInstance_id_fk" FOREIGN KEY ("workOrderId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" ADD CONSTRAINT "WorkOrderVisit_assigneeUserId_User_id_fk" FOREIGN KEY ("assigneeUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "WorkOrderVisit_organizationId_startTime_endTime_idx" ON "WorkOrderVisit" USING btree ("organizationId","startTime","endTime");--> statement-breakpoint
CREATE INDEX "WorkOrderVisit_assigneeUserId_startTime_idx" ON "WorkOrderVisit" USING btree ("assigneeUserId","startTime");--> statement-breakpoint
CREATE INDEX "WorkOrderVisit_workOrderId_idx" ON "WorkOrderVisit" USING btree ("workOrderId");--> statement-breakpoint
ALTER TABLE "RecordSequence" ADD CONSTRAINT "RecordSequence_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "RecordSequence_organizationId_scope_key" ON "RecordSequence" USING btree ("organizationId","scope");