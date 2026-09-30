CREATE TYPE "public"."BuildSource" AS ENUM('manual', 'order', 'batch', 'backflush');--> statement-breakpoint
CREATE TYPE "public"."BuildStatus" AS ENUM('planned', 'in_progress', 'completed', 'canceled');--> statement-breakpoint
CREATE TABLE "Build" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"createdById" text,
	"number" text NOT NULL,
	"partId" text NOT NULL,
	"status" "BuildStatus" DEFAULT 'planned' NOT NULL,
	"source" "BuildSource" DEFAULT 'manual' NOT NULL,
	"quantityPlanned" numeric(20, 6),
	"quantityProduced" numeric(20, 6),
	"quantityScrapped" numeric(20, 6),
	"startedAt" timestamp (3) with time zone,
	"completedAt" timestamp (3) with time zone,
	"postedAt" timestamp (3) with time zone,
	"materialCost" numeric(20, 3),
	"laborCost" numeric(20, 3),
	"overheadCost" numeric(20, 3),
	"producedValue" numeric(20, 3),
	"varianceAmount" numeric(20, 3),
	"orderId" text,
	"orderRevision" text,
	"periodStart" timestamp (3) with time zone,
	"periodEnd" timestamp (3) with time zone,
	"batchRun" integer,
	"reversalOfBuildId" text,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_buildId_EntityInstance_id_fk";
--> statement-breakpoint
ALTER TABLE "Build" ADD CONSTRAINT "Build_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Build" ADD CONSTRAINT "Build_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Build" ADD CONSTRAINT "Build_partId_EntityInstance_id_fk" FOREIGN KEY ("partId") REFERENCES "public"."EntityInstance"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Build" ADD CONSTRAINT "Build_orderId_EntityInstance_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Build" ADD CONSTRAINT "Build_reversalOfBuildId_Build_id_fk" FOREIGN KEY ("reversalOfBuildId") REFERENCES "public"."Build"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "Build_org_number_key" ON "Build" USING btree ("organizationId","number");--> statement-breakpoint
CREATE INDEX "Build_org_createdAt_idx" ON "Build" USING btree ("organizationId","createdAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "Build_org_status_idx" ON "Build" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX "Build_part_completedAt_idx" ON "Build" USING btree ("partId","completedAt");--> statement-breakpoint
CREATE INDEX "Build_orderId_idx" ON "Build" USING btree ("orderId") WHERE "orderId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "Build_org_batchRun_idx" ON "Build" USING btree ("organizationId","batchRun") WHERE "batchRun" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "Build_reversalOfBuildId_key" ON "Build" USING btree ("reversalOfBuildId") WHERE "reversalOfBuildId" IS NOT NULL;