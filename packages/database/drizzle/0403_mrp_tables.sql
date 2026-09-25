CREATE TYPE "public"."InventoryConsumptionClass" AS ENUM('consumption', 'scrap', 'supply', 'adjustment', 'none');--> statement-breakpoint
CREATE TYPE "public"."MrpFactorSource" AS ENUM('override', 'default');--> statement-breakpoint
CREATE TYPE "public"."MrpLeadTimeSource" AS ENUM('vendor', 'build', 'none');--> statement-breakpoint
CREATE TYPE "public"."MrpOrderMode" AS ENUM('when_needed', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."MrpPlanRunStatus" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."MrpSuggestionKind" AS ENUM('build', 'purchase');--> statement-breakpoint
CREATE TYPE "public"."MrpSupplyType" AS ENUM('bought', 'made', 'unclassified');--> statement-breakpoint
CREATE TABLE "InventoryMovementFact" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"partId" text NOT NULL,
	"type" text NOT NULL,
	"quantity" numeric NOT NULL,
	"occurredAt" timestamp with time zone NOT NULL,
	"consumptionClass" "InventoryConsumptionClass" NOT NULL,
	"reversesMovementId" text,
	"parentMovementId" text,
	"buildId" text,
	"fulfillmentLineId" text,
	"purchaseOrderLineId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "MrpPlanRun" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"status" "MrpPlanRunStatus" DEFAULT 'running' NOT NULL,
	"asOf" timestamp with time zone NOT NULL,
	"params" jsonb NOT NULL,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "MrpPlanRunItem" (
	"mrpPlanRunId" text NOT NULL,
	"organizationId" text NOT NULL,
	"partId" text NOT NULL,
	"supplyType" "MrpSupplyType" NOT NULL,
	"buffered" boolean NOT NULL,
	"proposedBuffered" boolean NOT NULL,
	"proposalReasons" text[] NOT NULL,
	"adu" numeric,
	"sigma" numeric,
	"cv" numeric,
	"stockoutDaysExcluded" integer,
	"onHand" numeric NOT NULL,
	"onOrder" numeric NOT NULL,
	"openDemand" numeric NOT NULL,
	"netFlow" numeric NOT NULL,
	"leadTimeDays" numeric,
	"leadTimeSource" "MrpLeadTimeSource" NOT NULL,
	"decoupledLeadTimeDays" numeric,
	"observedLeadTimeDays" numeric,
	"observedReceipts" integer,
	"leadTimeFactor" numeric,
	"leadTimeFactorSource" "MrpFactorSource",
	"variabilityFactor" numeric,
	"variabilityFactorSource" "MrpFactorSource",
	"orderCycleDays" numeric,
	"orderMode" "MrpOrderMode" NOT NULL,
	"nextOrderDate" date,
	"nextArrivalDate" date,
	"followingArrivalDate" date,
	"pullsOrderForward" boolean,
	"seasonalIndex" jsonb,
	"baseAdu" numeric,
	"topOfRed" numeric,
	"topOfYellow" numeric,
	"topOfGreen" numeric,
	"stockoutDate" date,
	"orderByDate" date,
	"priority" numeric,
	"suggestionKind" "MrpSuggestionKind",
	"suggestedQty" numeric,
	"suggestedPurchaseUnits" numeric,
	"suggestedVendorPartId" text,
	"suggestedSupplierId" text,
	"flags" text[] NOT NULL,
	"runAsOf" timestamp with time zone NOT NULL,
	"isLatest" boolean DEFAULT false NOT NULL,
	"isOverdue" boolean DEFAULT false NOT NULL,
	CONSTRAINT "MrpPlanRunItem_mrpPlanRunId_partId_pk" PRIMARY KEY("mrpPlanRunId","partId")
);
--> statement-breakpoint
ALTER TABLE "InventoryMovementFact" ADD CONSTRAINT "InventoryMovementFact_id_EntityInstance_id_fk" FOREIGN KEY ("id") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InventoryMovementFact" ADD CONSTRAINT "InventoryMovementFact_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MrpPlanRun" ADD CONSTRAINT "MrpPlanRun_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MrpPlanRunItem" ADD CONSTRAINT "MrpPlanRunItem_mrpPlanRunId_MrpPlanRun_id_fk" FOREIGN KEY ("mrpPlanRunId") REFERENCES "public"."MrpPlanRun"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "InventoryMovementFact_org_part_occurred_idx" ON "InventoryMovementFact" USING btree ("organizationId","partId","occurredAt");--> statement-breakpoint
CREATE INDEX "InventoryMovementFact_org_occurred_idx" ON "InventoryMovementFact" USING btree ("organizationId","occurredAt");--> statement-breakpoint
CREATE INDEX "InventoryMovementFact_po_line_idx" ON "InventoryMovementFact" USING btree ("purchaseOrderLineId");--> statement-breakpoint
CREATE INDEX "MrpPlanRun_org_asOf_idx" ON "MrpPlanRun" USING btree ("organizationId","asOf");--> statement-breakpoint
CREATE INDEX "MrpPlanRunItem_org_part_idx" ON "MrpPlanRunItem" USING btree ("organizationId","partId");