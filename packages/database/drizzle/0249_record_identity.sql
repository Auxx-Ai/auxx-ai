CREATE TABLE "RecordIdentity" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"entityInstanceId" text NOT NULL,
	"entityDefinitionId" text NOT NULL,
	"source" text NOT NULL,
	"appInstallationId" text,
	"connectionId" text,
	"appFieldKey" text,
	"fieldId" text,
	"externalId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "RecordIdentity" ADD CONSTRAINT "RecordIdentity_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordIdentity" ADD CONSTRAINT "RecordIdentity_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordIdentity" ADD CONSTRAINT "RecordIdentity_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordIdentity" ADD CONSTRAINT "RecordIdentity_appInstallationId_AppInstallation_id_fk" FOREIGN KEY ("appInstallationId") REFERENCES "public"."AppInstallation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordIdentity" ADD CONSTRAINT "RecordIdentity_connectionId_Credential_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."Credential"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordIdentity" ADD CONSTRAINT "RecordIdentity_fieldId_CustomField_id_fk" FOREIGN KEY ("fieldId") REFERENCES "public"."CustomField"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "RecordIdentity_org_def_source_externalId_idx" ON "RecordIdentity" USING btree ("organizationId","entityDefinitionId","source","externalId");--> statement-breakpoint
CREATE INDEX "RecordIdentity_org_source_conn_field_externalId_idx" ON "RecordIdentity" USING btree ("organizationId","source","connectionId","appFieldKey","externalId");--> statement-breakpoint
CREATE INDEX "RecordIdentity_entityInstanceId_idx" ON "RecordIdentity" USING btree ("entityInstanceId");--> statement-breakpoint
CREATE UNIQUE INDEX "RecordIdentity_identity_key" ON "RecordIdentity" USING btree ("organizationId","source",COALESCE("connectionId", ''),COALESCE("appFieldKey", ''),"externalId");--> statement-breakpoint
CREATE UNIQUE INDEX "RecordIdentity_record_kind_key" ON "RecordIdentity" USING btree ("entityInstanceId","source",COALESCE("connectionId", ''),COALESCE("appFieldKey", ''));