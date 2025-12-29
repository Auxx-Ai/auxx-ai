ALTER TYPE "public"."ContactFieldType" ADD VALUE 'RELATIONSHIP';--> statement-breakpoint
ALTER TYPE "public"."DataModelType" ADD VALUE 'ENTITY';--> statement-breakpoint
CREATE TABLE "EntityDefinition" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL,
	"apiSlug" text NOT NULL,
	"organizationId" text NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"icon" text DEFAULT 'Box' NOT NULL,
	"singular" text NOT NULL,
	"plural" text NOT NULL,
	"entityType" text,
	"standardType" text,
	"archivedAt" timestamp(3)
);
--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "systemAttribute" text;--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "entityDefinitionId" text;--> statement-breakpoint
ALTER TABLE "EntityDefinition" ADD CONSTRAINT "EntityDefinition_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "EntityDefinition_apiSlug_organizationId_key" ON "EntityDefinition" USING btree ("apiSlug","organizationId");--> statement-breakpoint
CREATE INDEX "EntityDefinition_organizationId_idx" ON "EntityDefinition" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "EntityDefinition_entityType_idx" ON "EntityDefinition" USING btree ("entityType");--> statement-breakpoint
CREATE INDEX "EntityDefinition_archivedAt_idx" ON "EntityDefinition" USING btree ("archivedAt");--> statement-breakpoint
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "CustomField_entityDefinitionId_idx" ON "CustomField" USING btree ("entityDefinitionId");