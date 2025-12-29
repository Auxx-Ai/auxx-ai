CREATE TABLE "EntityInstance" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL,
	"archivedAt" timestamp(3),
	"entityDefinitionId" text NOT NULL,
	"organizationId" text NOT NULL,
	"createdById" text
);
--> statement-breakpoint
ALTER TABLE "EntityDefinition" ADD COLUMN "primaryDisplayFieldId" text;--> statement-breakpoint
ALTER TABLE "EntityDefinition" ADD COLUMN "secondaryDisplayFieldId" text;--> statement-breakpoint
ALTER TABLE "EntityDefinition" ADD COLUMN "avatarFieldId" text;--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD CONSTRAINT "EntityInstance_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD CONSTRAINT "EntityInstance_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD CONSTRAINT "EntityInstance_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "EntityInstance_entityDefinitionId_idx" ON "EntityInstance" USING btree ("entityDefinitionId");--> statement-breakpoint
CREATE INDEX "EntityInstance_organizationId_idx" ON "EntityInstance" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "EntityInstance_archivedAt_idx" ON "EntityInstance" USING btree ("archivedAt");--> statement-breakpoint
CREATE INDEX "EntityInstance_orgId_defId_idx" ON "EntityInstance" USING btree ("organizationId","entityDefinitionId");--> statement-breakpoint
ALTER TABLE "EntityDefinition" ADD CONSTRAINT "EntityDefinition_primaryDisplayFieldId_CustomField_id_fk" FOREIGN KEY ("primaryDisplayFieldId") REFERENCES "public"."CustomField"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntityDefinition" ADD CONSTRAINT "EntityDefinition_secondaryDisplayFieldId_CustomField_id_fk" FOREIGN KEY ("secondaryDisplayFieldId") REFERENCES "public"."CustomField"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntityDefinition" ADD CONSTRAINT "EntityDefinition_avatarFieldId_CustomField_id_fk" FOREIGN KEY ("avatarFieldId") REFERENCES "public"."CustomField"("id") ON DELETE set null ON UPDATE cascade;