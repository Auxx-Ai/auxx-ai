CREATE TYPE "public"."InvoiceAllocationStatus" AS ENUM('active', 'released');--> statement-breakpoint
CREATE TYPE "public"."InvoiceLineAllocationKind" AS ENUM('contract', 'visit_template', 'visit_addition', 'recurring_charge');--> statement-breakpoint
CREATE TYPE "public"."InvoiceVisitAllocationKind" AS ENUM('base', 'additional');--> statement-breakpoint
CREATE TYPE "public"."WorkOrderBillingInstallmentCalculation" AS ENUM('percentage', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."WorkOrderBillingInstallmentStatus" AS ENUM('pending', 'drafted', 'invoiced', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."WorkOrderBillingInstallmentTrigger" AS ENUM('manual', 'date', 'work_order_completion');--> statement-breakpoint
CREATE TABLE "InvoiceLineAllocation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"workOrderId" text NOT NULL,
	"invoiceId" text NOT NULL,
	"invoiceLineItemId" text NOT NULL,
	"sourceLineItemId" text NOT NULL,
	"visitId" text,
	"kind" "InvoiceLineAllocationKind" NOT NULL,
	"amount" integer NOT NULL,
	"quantity" numeric,
	"status" "InvoiceAllocationStatus" DEFAULT 'active' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"releasedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "InvoiceScheduleAllocation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"workOrderId" text NOT NULL,
	"invoiceId" text NOT NULL,
	"recurrenceRuleId" text NOT NULL,
	"occurrenceDate" date NOT NULL,
	"status" "InvoiceAllocationStatus" DEFAULT 'active' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"releasedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "InvoiceVisitAllocation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"workOrderId" text NOT NULL,
	"invoiceId" text NOT NULL,
	"visitId" text NOT NULL,
	"kind" "InvoiceVisitAllocationKind" NOT NULL,
	"status" "InvoiceAllocationStatus" DEFAULT 'active' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"releasedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "WorkOrderBillingInstallment" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"workOrderId" text NOT NULL,
	"name" text NOT NULL,
	"sortOrder" integer NOT NULL,
	"calculation" "WorkOrderBillingInstallmentCalculation" NOT NULL,
	"percentageBasisPoints" integer,
	"amount" integer NOT NULL,
	"trigger" "WorkOrderBillingInstallmentTrigger" NOT NULL,
	"scheduledDate" date,
	"invoiceId" text,
	"status" "WorkOrderBillingInstallmentStatus" DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "WorkOrderBillingInstallment_calculation_check" CHECK (("WorkOrderBillingInstallment"."calculation" = 'percentage' AND "WorkOrderBillingInstallment"."percentageBasisPoints" BETWEEN 1 AND 10000) OR ("WorkOrderBillingInstallment"."calculation" = 'fixed' AND "WorkOrderBillingInstallment"."percentageBasisPoints" IS NULL)),
	CONSTRAINT "WorkOrderBillingInstallment_scheduledDate_check" CHECK ("WorkOrderBillingInstallment"."trigger" <> 'date' OR "WorkOrderBillingInstallment"."scheduledDate" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "InvoiceLineAllocation" ADD CONSTRAINT "InvoiceLineAllocation_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceLineAllocation" ADD CONSTRAINT "InvoiceLineAllocation_workOrderId_EntityInstance_id_fk" FOREIGN KEY ("workOrderId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceLineAllocation" ADD CONSTRAINT "InvoiceLineAllocation_invoiceId_EntityInstance_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceLineAllocation" ADD CONSTRAINT "InvoiceLineAllocation_invoiceLineItemId_EntityInstance_id_fk" FOREIGN KEY ("invoiceLineItemId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceLineAllocation" ADD CONSTRAINT "InvoiceLineAllocation_sourceLineItemId_EntityInstance_id_fk" FOREIGN KEY ("sourceLineItemId") REFERENCES "public"."EntityInstance"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceLineAllocation" ADD CONSTRAINT "InvoiceLineAllocation_visitId_WorkOrderVisit_id_fk" FOREIGN KEY ("visitId") REFERENCES "public"."WorkOrderVisit"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceScheduleAllocation" ADD CONSTRAINT "InvoiceScheduleAllocation_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceScheduleAllocation" ADD CONSTRAINT "InvoiceScheduleAllocation_workOrderId_EntityInstance_id_fk" FOREIGN KEY ("workOrderId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceScheduleAllocation" ADD CONSTRAINT "InvoiceScheduleAllocation_invoiceId_EntityInstance_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceScheduleAllocation" ADD CONSTRAINT "InvoiceScheduleAllocation_recurrenceRuleId_RecurrenceRule_id_fk" FOREIGN KEY ("recurrenceRuleId") REFERENCES "public"."RecurrenceRule"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceVisitAllocation" ADD CONSTRAINT "InvoiceVisitAllocation_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceVisitAllocation" ADD CONSTRAINT "InvoiceVisitAllocation_workOrderId_EntityInstance_id_fk" FOREIGN KEY ("workOrderId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceVisitAllocation" ADD CONSTRAINT "InvoiceVisitAllocation_invoiceId_EntityInstance_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InvoiceVisitAllocation" ADD CONSTRAINT "InvoiceVisitAllocation_visitId_WorkOrderVisit_id_fk" FOREIGN KEY ("visitId") REFERENCES "public"."WorkOrderVisit"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkOrderBillingInstallment" ADD CONSTRAINT "WorkOrderBillingInstallment_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkOrderBillingInstallment" ADD CONSTRAINT "WorkOrderBillingInstallment_workOrderId_EntityInstance_id_fk" FOREIGN KEY ("workOrderId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkOrderBillingInstallment" ADD CONSTRAINT "WorkOrderBillingInstallment_invoiceId_EntityInstance_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "InvoiceLineAllocation_invoiceLineItemId_key" ON "InvoiceLineAllocation" USING btree ("invoiceLineItemId");--> statement-breakpoint
CREATE UNIQUE INDEX "InvoiceLineAllocation_sourceLineItemId_active_visitAddition_key" ON "InvoiceLineAllocation" USING btree ("sourceLineItemId") WHERE "InvoiceLineAllocation"."status" = 'active' AND "InvoiceLineAllocation"."kind" = 'visit_addition';--> statement-breakpoint
CREATE UNIQUE INDEX "InvoiceLineAllocation_sourceLineItemId_visitId_active_template_key" ON "InvoiceLineAllocation" USING btree ("sourceLineItemId","visitId") WHERE "InvoiceLineAllocation"."status" = 'active' AND "InvoiceLineAllocation"."kind" = 'visit_template';--> statement-breakpoint
CREATE INDEX "InvoiceLineAllocation_organizationId_workOrderId_idx" ON "InvoiceLineAllocation" USING btree ("organizationId","workOrderId");--> statement-breakpoint
CREATE INDEX "InvoiceLineAllocation_invoiceId_idx" ON "InvoiceLineAllocation" USING btree ("invoiceId");--> statement-breakpoint
CREATE INDEX "InvoiceLineAllocation_sourceLineItemId_idx" ON "InvoiceLineAllocation" USING btree ("sourceLineItemId");--> statement-breakpoint
CREATE INDEX "InvoiceLineAllocation_visitId_idx" ON "InvoiceLineAllocation" USING btree ("visitId");--> statement-breakpoint
CREATE UNIQUE INDEX "InvoiceScheduleAllocation_recurrenceRuleId_occurrenceDate_active_key" ON "InvoiceScheduleAllocation" USING btree ("recurrenceRuleId","occurrenceDate") WHERE "InvoiceScheduleAllocation"."status" = 'active';--> statement-breakpoint
CREATE INDEX "InvoiceScheduleAllocation_organizationId_workOrderId_idx" ON "InvoiceScheduleAllocation" USING btree ("organizationId","workOrderId");--> statement-breakpoint
CREATE INDEX "InvoiceScheduleAllocation_invoiceId_idx" ON "InvoiceScheduleAllocation" USING btree ("invoiceId");--> statement-breakpoint
CREATE INDEX "InvoiceScheduleAllocation_recurrenceRuleId_idx" ON "InvoiceScheduleAllocation" USING btree ("recurrenceRuleId");--> statement-breakpoint
CREATE UNIQUE INDEX "InvoiceVisitAllocation_invoiceId_visitId_kind_key" ON "InvoiceVisitAllocation" USING btree ("invoiceId","visitId","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "InvoiceVisitAllocation_visitId_active_base_key" ON "InvoiceVisitAllocation" USING btree ("visitId","kind") WHERE "InvoiceVisitAllocation"."status" = 'active' AND "InvoiceVisitAllocation"."kind" = 'base';--> statement-breakpoint
CREATE INDEX "InvoiceVisitAllocation_organizationId_workOrderId_idx" ON "InvoiceVisitAllocation" USING btree ("organizationId","workOrderId");--> statement-breakpoint
CREATE INDEX "InvoiceVisitAllocation_invoiceId_idx" ON "InvoiceVisitAllocation" USING btree ("invoiceId");--> statement-breakpoint
CREATE INDEX "InvoiceVisitAllocation_visitId_idx" ON "InvoiceVisitAllocation" USING btree ("visitId");--> statement-breakpoint
CREATE INDEX "WorkOrderBillingInstallment_organizationId_workOrderId_idx" ON "WorkOrderBillingInstallment" USING btree ("organizationId","workOrderId");--> statement-breakpoint
CREATE INDEX "WorkOrderBillingInstallment_invoiceId_idx" ON "WorkOrderBillingInstallment" USING btree ("invoiceId");--> statement-breakpoint
CREATE INDEX "WorkOrderBillingInstallment_status_scheduledDate_idx" ON "WorkOrderBillingInstallment" USING btree ("status","scheduledDate");