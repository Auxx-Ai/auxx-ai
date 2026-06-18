CREATE TYPE "public"."DataConnectorStatus" AS ENUM('pending', 'provisioning', 'syncing', 'live', 'error', 'paused');--> statement-breakpoint
CREATE TYPE "public"."DataConnectorSyncBehavior" AS ENUM('manual', 'scheduled', 'webhook');--> statement-breakpoint
CREATE TABLE "DataConnectorItem" (
	"id" text PRIMARY KEY NOT NULL,
	"dataConnectorId" text NOT NULL,
	"organizationId" text NOT NULL,
	"mappingId" text NOT NULL,
	"externalId" text NOT NULL,
	"entityDefinitionId" text NOT NULL,
	"entityInstanceId" text,
	"contentHash" text,
	"managedFields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pendingRelations" jsonb,
	"upstreamUpdatedAt" timestamp (3),
	"lastSeenRunId" text,
	"lastSyncedAt" timestamp (3),
	"archivedAt" timestamp (3) with time zone,
	"error" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "DataConnectorMapping" (
	"id" text PRIMARY KEY NOT NULL,
	"dataConnectorStreamId" text NOT NULL,
	"organizationId" text NOT NULL,
	"rootPath" text DEFAULT '' NOT NULL,
	"linkMode" text DEFAULT 'upsert' NOT NULL,
	"parentMappingId" text,
	"relationshipFieldKey" text,
	"targetMode" text NOT NULL,
	"entityDefinitionId" text NOT NULL,
	"fieldMappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mergeStrategies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"identityStrategy" jsonb NOT NULL,
	"orphanBehavior" text DEFAULT 'ignore' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "DataConnectorRun" (
	"id" text PRIMARY KEY NOT NULL,
	"dataConnectorId" text NOT NULL,
	"organizationId" text NOT NULL,
	"trigger" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"archived" integer DEFAULT 0 NOT NULL,
	"deleted" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"relationshipWarnings" integer DEFAULT 0 NOT NULL,
	"errorSample" jsonb,
	"cursorBefore" jsonb,
	"cursorAfter" jsonb,
	"startedAt" timestamp (3) DEFAULT now() NOT NULL,
	"finishedAt" timestamp (3),
	"durationMs" integer
);
--> statement-breakpoint
CREATE TABLE "DataConnectorStream" (
	"id" text PRIMARY KEY NOT NULL,
	"dataConnectorId" text NOT NULL,
	"organizationId" text NOT NULL,
	"streamKey" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sourceSchema" jsonb,
	"schemaSource" text DEFAULT 'catalog' NOT NULL,
	"syncMode" text DEFAULT 'snapshot' NOT NULL,
	"requestConfig" jsonb,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sampleRunId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "DataConnector" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdById" text,
	"type" text NOT NULL,
	"definitionKind" text DEFAULT 'builtin' NOT NULL,
	"name" text NOT NULL,
	"credentialId" text,
	"appInstallationId" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"syncBehavior" "DataConnectorSyncBehavior" DEFAULT 'manual' NOT NULL,
	"scheduleConfig" jsonb,
	"status" "DataConnectorStatus" DEFAULT 'pending' NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schemaHash" text,
	"lastSyncedAt" timestamp (3),
	"lastJobId" text,
	"itemCount" integer DEFAULT 0 NOT NULL,
	"error" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "dataConnectorId" text;--> statement-breakpoint
ALTER TABLE "EntityDefinition" ADD COLUMN "dataConnectorId" text;--> statement-breakpoint
ALTER TABLE "DataConnectorItem" ADD CONSTRAINT "DataConnectorItem_dataConnectorId_DataConnector_id_fk" FOREIGN KEY ("dataConnectorId") REFERENCES "public"."DataConnector"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnectorItem" ADD CONSTRAINT "DataConnectorItem_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnectorItem" ADD CONSTRAINT "DataConnectorItem_mappingId_DataConnectorMapping_id_fk" FOREIGN KEY ("mappingId") REFERENCES "public"."DataConnectorMapping"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnectorItem" ADD CONSTRAINT "DataConnectorItem_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnectorItem" ADD CONSTRAINT "DataConnectorItem_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnectorMapping" ADD CONSTRAINT "DataConnectorMapping_dataConnectorStreamId_DataConnectorStream_id_fk" FOREIGN KEY ("dataConnectorStreamId") REFERENCES "public"."DataConnectorStream"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnectorMapping" ADD CONSTRAINT "DataConnectorMapping_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnectorMapping" ADD CONSTRAINT "DataConnectorMapping_parentMappingId_DataConnectorMapping_id_fk" FOREIGN KEY ("parentMappingId") REFERENCES "public"."DataConnectorMapping"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnectorMapping" ADD CONSTRAINT "DataConnectorMapping_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnectorRun" ADD CONSTRAINT "DataConnectorRun_dataConnectorId_DataConnector_id_fk" FOREIGN KEY ("dataConnectorId") REFERENCES "public"."DataConnector"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnectorRun" ADD CONSTRAINT "DataConnectorRun_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnectorStream" ADD CONSTRAINT "DataConnectorStream_dataConnectorId_DataConnector_id_fk" FOREIGN KEY ("dataConnectorId") REFERENCES "public"."DataConnector"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnectorStream" ADD CONSTRAINT "DataConnectorStream_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnector" ADD CONSTRAINT "DataConnector_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnector" ADD CONSTRAINT "DataConnector_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnector" ADD CONSTRAINT "DataConnector_credentialId_Credential_id_fk" FOREIGN KEY ("credentialId") REFERENCES "public"."Credential"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DataConnector" ADD CONSTRAINT "DataConnector_appInstallationId_AppInstallation_id_fk" FOREIGN KEY ("appInstallationId") REFERENCES "public"."AppInstallation"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "DataConnectorItem_dataConnectorId_mappingId_externalId_key" ON "DataConnectorItem" USING btree ("dataConnectorId","mappingId","externalId");--> statement-breakpoint
CREATE INDEX "DataConnectorItem_entityInstanceId_idx" ON "DataConnectorItem" USING btree ("entityInstanceId");--> statement-breakpoint
CREATE INDEX "DataConnectorItem_dataConnectorId_mappingId_lastSeenRunId_idx" ON "DataConnectorItem" USING btree ("dataConnectorId","mappingId","lastSeenRunId");--> statement-breakpoint
CREATE INDEX "DataConnectorMapping_dataConnectorStreamId_idx" ON "DataConnectorMapping" USING btree ("dataConnectorStreamId");--> statement-breakpoint
CREATE INDEX "DataConnectorMapping_entityDefinitionId_idx" ON "DataConnectorMapping" USING btree ("entityDefinitionId");--> statement-breakpoint
CREATE INDEX "DataConnectorMapping_parentMappingId_idx" ON "DataConnectorMapping" USING btree ("parentMappingId");--> statement-breakpoint
CREATE INDEX "DataConnectorRun_dataConnectorId_startedAt_idx" ON "DataConnectorRun" USING btree ("dataConnectorId","startedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "DataConnectorStream_dataConnectorId_streamKey_key" ON "DataConnectorStream" USING btree ("dataConnectorId","streamKey");--> statement-breakpoint
CREATE INDEX "DataConnector_organizationId_idx" ON "DataConnector" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "DataConnector_organizationId_type_key" ON "DataConnector" USING btree ("organizationId","type");--> statement-breakpoint
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_dataConnectorId_DataConnector_id_fk" FOREIGN KEY ("dataConnectorId") REFERENCES "public"."DataConnector"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntityDefinition" ADD CONSTRAINT "EntityDefinition_dataConnectorId_DataConnector_id_fk" FOREIGN KEY ("dataConnectorId") REFERENCES "public"."DataConnector"("id") ON DELETE set null ON UPDATE cascade;