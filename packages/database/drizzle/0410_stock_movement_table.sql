CREATE TYPE "public"."StockMovementCostBasis" AS ENUM('standard', 'actual', 'pending');--> statement-breakpoint
CREATE TYPE "public"."StockMovementType" AS ENUM('receive', 'ship', 'adjust', 'sale', 'build_consume', 'build_produce', 'scrap', 'return_in', 'return_out', 'initial', 'revalue');--> statement-breakpoint
CREATE TABLE "StockMovement" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"partId" text NOT NULL,
	"type" "StockMovementType" NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"reason" text,
	"reference" text,
	"adjustSubparts" boolean DEFAULT false NOT NULL,
	"parentMovementId" text,
	"unitCostMinor" numeric(20, 3),
	"extendedCostMinor" bigint,
	"costBasis" "StockMovementCostBasis",
	"glRole" text,
	"occurredAt" timestamp (3) with time zone,
	"vendorPartId" text,
	"vendorUnitPriceMinor" numeric(20, 3),
	"freightAccruedMinor" bigint,
	"dutiesAccruedMinor" bigint,
	"tariffRate" numeric(12, 6),
	"purchaseOrderLineId" text,
	"reversesMovementId" text,
	"buildId" text,
	"qtyPerUnit" numeric(20, 6),
	"fulfillmentLineId" text,
	"returnPartLineId" text,
	"countQuantity" numeric(20, 6),
	"countDate" date,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"createdById" text,
	"effectiveAt" timestamp (3) with time zone GENERATED ALWAYS AS (COALESCE("occurredAt", "createdAt")) STORED NOT NULL,
	CONSTRAINT "StockMovement_pending_cost_check" CHECK (("costBasis" = 'pending') = ("unitCostMinor" IS NULL)),
	CONSTRAINT "StockMovement_pending_extended_check" CHECK ("costBasis" <> 'pending' OR "extendedCostMinor" IS NULL),
	CONSTRAINT "StockMovement_quantity_check" CHECK ("quantity" <> 0 OR "type" = 'revalue')
);
--> statement-breakpoint
ALTER TABLE "InventoryMovementFact" DROP CONSTRAINT "InventoryMovementFact_id_EntityInstance_id_fk";
--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_partId_EntityInstance_id_fk" FOREIGN KEY ("partId") REFERENCES "public"."EntityInstance"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_parentMovementId_StockMovement_id_fk" FOREIGN KEY ("parentMovementId") REFERENCES "public"."StockMovement"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_vendorPartId_EntityInstance_id_fk" FOREIGN KEY ("vendorPartId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_purchaseOrderLineId_EntityInstance_id_fk" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "public"."EntityInstance"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reversesMovementId_StockMovement_id_fk" FOREIGN KEY ("reversesMovementId") REFERENCES "public"."StockMovement"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_buildId_EntityInstance_id_fk" FOREIGN KEY ("buildId") REFERENCES "public"."EntityInstance"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_fulfillmentLineId_EntityInstance_id_fk" FOREIGN KEY ("fulfillmentLineId") REFERENCES "public"."EntityInstance"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_returnPartLineId_EntityInstance_id_fk" FOREIGN KEY ("returnPartLineId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "StockMovement_part_effectiveAt_idx" ON "StockMovement" USING btree ("partId","effectiveAt");--> statement-breakpoint
CREATE INDEX "StockMovement_org_effectiveAt_idx" ON "StockMovement" USING btree ("organizationId","effectiveAt");--> statement-breakpoint
CREATE INDEX "StockMovement_buildId_idx" ON "StockMovement" USING btree ("buildId") WHERE "buildId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "StockMovement_purchaseOrderLineId_idx" ON "StockMovement" USING btree ("purchaseOrderLineId") WHERE "purchaseOrderLineId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "StockMovement_fulfillmentLineId_idx" ON "StockMovement" USING btree ("fulfillmentLineId") WHERE "fulfillmentLineId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "StockMovement_vendorPartId_idx" ON "StockMovement" USING btree ("vendorPartId") WHERE "vendorPartId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "StockMovement_returnPartLineId_idx" ON "StockMovement" USING btree ("returnPartLineId") WHERE "returnPartLineId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "StockMovement_parentMovementId_idx" ON "StockMovement" USING btree ("parentMovementId") WHERE "parentMovementId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "StockMovement_org_pending_idx" ON "StockMovement" USING btree ("organizationId","partId") WHERE "costBasis" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "StockMovement_reversesMovementId_key" ON "StockMovement" USING btree ("reversesMovementId") WHERE "reversesMovementId" IS NOT NULL;