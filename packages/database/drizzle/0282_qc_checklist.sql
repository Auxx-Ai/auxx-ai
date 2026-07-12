CREATE TABLE "QcItemTemplate" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"isRequired" boolean DEFAULT false NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "VisitQcItem" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"visitId" text NOT NULL,
	"templateId" text,
	"title" text NOT NULL,
	"isRequired" boolean DEFAULT false NOT NULL,
	"note" text,
	"checkedAt" timestamp (3) with time zone,
	"checkedByUserId" text,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "QcItemTemplate" ADD CONSTRAINT "QcItemTemplate_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "VisitQcItem" ADD CONSTRAINT "VisitQcItem_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "VisitQcItem" ADD CONSTRAINT "VisitQcItem_visitId_WorkOrderVisit_id_fk" FOREIGN KEY ("visitId") REFERENCES "public"."WorkOrderVisit"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "VisitQcItem" ADD CONSTRAINT "VisitQcItem_templateId_QcItemTemplate_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."QcItemTemplate"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "VisitQcItem" ADD CONSTRAINT "VisitQcItem_checkedByUserId_User_id_fk" FOREIGN KEY ("checkedByUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "QcItemTemplate_organizationId_isActive_idx" ON "QcItemTemplate" USING btree ("organizationId","isActive");--> statement-breakpoint
CREATE INDEX "VisitQcItem_visitId_idx" ON "VisitQcItem" USING btree ("visitId");