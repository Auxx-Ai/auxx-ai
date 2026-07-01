CREATE TYPE "public"."ExportJobStatus" AS ENUM('pending', 'processing', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "ExportJob" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"createdById" text NOT NULL,
	"entityDefinitionId" text NOT NULL,
	"tableId" text,
	"viewId" text,
	"exportType" text NOT NULL,
	"status" "ExportJobStatus" DEFAULT 'pending' NOT NULL,
	"filters" jsonb,
	"sorting" jsonb,
	"columns" jsonb NOT NULL,
	"totalRecords" integer DEFAULT 0 NOT NULL,
	"processedRecords" integer DEFAULT 0 NOT NULL,
	"storageLocationId" text,
	"fileName" text,
	"fileSizeBytes" integer,
	"error" text,
	"startedAt" timestamp (3),
	"completedAt" timestamp (3)
);
--> statement-breakpoint
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_storageLocationId_StorageLocation_id_fk" FOREIGN KEY ("storageLocationId") REFERENCES "public"."StorageLocation"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ExportJob_organizationId_idx" ON "ExportJob" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "ExportJob_status_idx" ON "ExportJob" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ExportJob_createdById_idx" ON "ExportJob" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "ExportJob_entityDefinitionId_idx" ON "ExportJob" USING btree ("entityDefinitionId");