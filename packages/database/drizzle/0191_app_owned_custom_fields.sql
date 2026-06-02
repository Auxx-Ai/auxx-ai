DROP INDEX "CustomField_name_org_model_entity_key";--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "appInstallationId" text;--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "connectionId" text;--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "appFieldKey" text;--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "isHidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_appInstallationId_AppInstallation_id_fk" FOREIGN KEY ("appInstallationId") REFERENCES "public"."AppInstallation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_connectionId_WorkflowCredentials_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."WorkflowCredentials"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "CustomField_app_field_key" ON "CustomField" USING btree ("appInstallationId",COALESCE("connectionId", ''),"appFieldKey","modelType","entityDefinitionId") WHERE "CustomField"."appInstallationId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "CustomField_name_org_model_entity_key" ON "CustomField" USING btree ("name","organizationId","modelType","entityDefinitionId") WHERE "CustomField"."appInstallationId" IS NULL;