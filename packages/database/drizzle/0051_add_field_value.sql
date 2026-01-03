CREATE TABLE "FieldValue" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL,
	"organizationId" text NOT NULL,
	"fieldId" text NOT NULL,
	"entityId" text NOT NULL,
	"valueText" text,
	"valueNumber" double precision,
	"valueBoolean" boolean,
	"valueDate" timestamp(3),
	"valueJson" jsonb,
	"optionId" text,
	"relatedEntityId" text,
	"sortKey" text DEFAULT 'a' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "isCreatable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "isUpdatable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "isComputed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "isSortable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "isFilterable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD COLUMN "displayName" text;--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD COLUMN "searchText" text;--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "FieldValue" ADD CONSTRAINT "FieldValue_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FieldValue" ADD CONSTRAINT "FieldValue_fieldId_CustomField_id_fk" FOREIGN KEY ("fieldId") REFERENCES "public"."CustomField"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "FieldValue_organizationId_idx" ON "FieldValue" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "FieldValue_entityId_idx" ON "FieldValue" USING btree ("entityId");--> statement-breakpoint
CREATE INDEX "FieldValue_fieldId_idx" ON "FieldValue" USING btree ("fieldId");--> statement-breakpoint
CREATE INDEX "FieldValue_entityId_fieldId_idx" ON "FieldValue" USING btree ("entityId","fieldId");--> statement-breakpoint
CREATE INDEX "FieldValue_optionId_idx" ON "FieldValue" USING btree ("optionId");--> statement-breakpoint
CREATE INDEX "FieldValue_relatedEntityId_idx" ON "FieldValue" USING btree ("relatedEntityId");--> statement-breakpoint
CREATE UNIQUE INDEX "FieldValue_entity_field_sortKey_key" ON "FieldValue" USING btree ("entityId","fieldId","sortKey");--> statement-breakpoint
CREATE INDEX "EntityInstance_displayName_idx" ON "EntityInstance" USING btree ("displayName");