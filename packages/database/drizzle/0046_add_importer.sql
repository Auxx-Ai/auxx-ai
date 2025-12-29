CREATE TYPE "public"."ImportJobStatus" AS ENUM('uploading', 'ingesting', 'waiting', 'planning', 'ready', 'executing', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."ImportMappingTargetType" AS ENUM('particle', 'relation', 'skip');--> statement-breakpoint
CREATE TYPE "public"."ImportPlanRowStatus" AS ENUM('planned', 'executing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ImportPlanStatus" AS ENUM('planning', 'planned', 'executing', 'completed');--> statement-breakpoint
CREATE TYPE "public"."ImportResolutionStatus" AS ENUM('pending', 'valid', 'error', 'warning', 'create');--> statement-breakpoint
CREATE TYPE "public"."ImportStrategyStatus" AS ENUM('planning_queued', 'planning', 'planned', 'executing', 'completed');--> statement-breakpoint
CREATE TYPE "public"."ImportStrategyType" AS ENUM('create', 'update', 'skip');--> statement-breakpoint
CREATE TABLE "ImportJobMappableProperty" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"importJobId" text NOT NULL,
	"columnIndex" integer NOT NULL,
	"visibleName" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ImportJobProperty" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"importJobId" text NOT NULL,
	"importMappingPropertyId" text NOT NULL,
	"uniqueValueCount" integer DEFAULT 0 NOT NULL,
	"resolvedCount" integer DEFAULT 0 NOT NULL,
	"errorCount" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ImportJobRawData" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"importJobId" text NOT NULL,
	"rowIndex" integer NOT NULL,
	"columnIndex" integer NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"valueHash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ImportJob" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"importMappingId" text NOT NULL,
	"sourceFileName" text NOT NULL,
	"columnCount" integer NOT NULL,
	"rowCount" integer NOT NULL,
	"totalChunks" integer,
	"receivedChunks" integer DEFAULT 0,
	"status" "ImportJobStatus" DEFAULT 'uploading' NOT NULL,
	"ingestionFailureReason" text,
	"allowPlanGeneration" boolean DEFAULT false NOT NULL,
	"statistics" jsonb,
	"createdById" text,
	"confirmedAt" timestamp (3),
	"startedExecutionAt" timestamp (3),
	"completedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "ImportMappingProperty" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"importMappingId" text NOT NULL,
	"sourceColumnIndex" integer NOT NULL,
	"sourceColumnName" text,
	"targetType" "ImportMappingTargetType" DEFAULT 'skip' NOT NULL,
	"targetFieldKey" text,
	"customFieldId" text,
	"resolutionType" text DEFAULT 'text:value' NOT NULL,
	"resolutionConfig" text
);
--> statement-breakpoint
CREATE TABLE "ImportMapping" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"targetTable" text NOT NULL,
	"entityDefinitionId" text,
	"title" text NOT NULL,
	"sourceType" text DEFAULT 'csv' NOT NULL,
	"defaultStrategy" text DEFAULT 'create' NOT NULL,
	"identifierFieldKey" text,
	"createdById" text
);
--> statement-breakpoint
CREATE TABLE "ImportPlanRow" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"importPlanStrategyId" text NOT NULL,
	"rowIndex" integer NOT NULL,
	"existingRecordId" text,
	"status" "ImportPlanRowStatus" DEFAULT 'planned' NOT NULL,
	"resultRecordId" text,
	"errorMessage" text,
	"executedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "ImportPlanStrategy" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"importPlanId" text NOT NULL,
	"strategy" "ImportStrategyType" NOT NULL,
	"matchingFieldKey" text,
	"matchingCustomFieldId" text,
	"status" "ImportStrategyStatus" DEFAULT 'planning_queued' NOT NULL,
	"planningProgress" jsonb,
	"statistics" jsonb,
	"planningStartedAt" timestamp (3),
	"planningCompletedAt" timestamp (3),
	"executionStartedAt" timestamp (3),
	"executionCompletedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "ImportPlan" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"importJobId" text NOT NULL,
	"status" "ImportPlanStatus" DEFAULT 'planning' NOT NULL,
	"completedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "ImportValueResolution" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"importJobPropertyId" text NOT NULL,
	"hashedValue" text NOT NULL,
	"rawValue" text NOT NULL,
	"cellCount" integer DEFAULT 1 NOT NULL,
	"resolvedValues" jsonb NOT NULL,
	"status" "ImportResolutionStatus" DEFAULT 'pending' NOT NULL,
	"isValid" boolean DEFAULT true NOT NULL,
	"errorMessage" text,
	"userOverride" jsonb,
	"overriddenAt" timestamp (3)
);
--> statement-breakpoint
ALTER TABLE "ImportJobMappableProperty" ADD CONSTRAINT "ImportJobMappableProperty_importJobId_ImportJob_id_fk" FOREIGN KEY ("importJobId") REFERENCES "public"."ImportJob"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportJobProperty" ADD CONSTRAINT "ImportJobProperty_importJobId_ImportJob_id_fk" FOREIGN KEY ("importJobId") REFERENCES "public"."ImportJob"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportJobProperty" ADD CONSTRAINT "ImportJobProperty_importMappingPropertyId_ImportMappingProperty_id_fk" FOREIGN KEY ("importMappingPropertyId") REFERENCES "public"."ImportMappingProperty"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportJobRawData" ADD CONSTRAINT "ImportJobRawData_importJobId_ImportJob_id_fk" FOREIGN KEY ("importJobId") REFERENCES "public"."ImportJob"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_importMappingId_ImportMapping_id_fk" FOREIGN KEY ("importMappingId") REFERENCES "public"."ImportMapping"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportMappingProperty" ADD CONSTRAINT "ImportMappingProperty_importMappingId_ImportMapping_id_fk" FOREIGN KEY ("importMappingId") REFERENCES "public"."ImportMapping"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportMappingProperty" ADD CONSTRAINT "ImportMappingProperty_customFieldId_CustomField_id_fk" FOREIGN KEY ("customFieldId") REFERENCES "public"."CustomField"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportMapping" ADD CONSTRAINT "ImportMapping_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportMapping" ADD CONSTRAINT "ImportMapping_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportMapping" ADD CONSTRAINT "ImportMapping_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportPlanRow" ADD CONSTRAINT "ImportPlanRow_importPlanStrategyId_ImportPlanStrategy_id_fk" FOREIGN KEY ("importPlanStrategyId") REFERENCES "public"."ImportPlanStrategy"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportPlanStrategy" ADD CONSTRAINT "ImportPlanStrategy_importPlanId_ImportPlan_id_fk" FOREIGN KEY ("importPlanId") REFERENCES "public"."ImportPlan"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportPlanStrategy" ADD CONSTRAINT "ImportPlanStrategy_matchingCustomFieldId_CustomField_id_fk" FOREIGN KEY ("matchingCustomFieldId") REFERENCES "public"."CustomField"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportPlan" ADD CONSTRAINT "ImportPlan_importJobId_ImportJob_id_fk" FOREIGN KEY ("importJobId") REFERENCES "public"."ImportJob"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ImportValueResolution" ADD CONSTRAINT "ImportValueResolution_importJobPropertyId_ImportJobProperty_id_fk" FOREIGN KEY ("importJobPropertyId") REFERENCES "public"."ImportJobProperty"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ImportJobMappableProperty_importJobId_idx" ON "ImportJobMappableProperty" USING btree ("importJobId");--> statement-breakpoint
CREATE UNIQUE INDEX "ImportJobMappableProperty_jobId_columnIndex_key" ON "ImportJobMappableProperty" USING btree ("importJobId","columnIndex");--> statement-breakpoint
CREATE INDEX "ImportJobProperty_importJobId_idx" ON "ImportJobProperty" USING btree ("importJobId");--> statement-breakpoint
CREATE UNIQUE INDEX "ImportJobProperty_jobId_mappingPropertyId_key" ON "ImportJobProperty" USING btree ("importJobId","importMappingPropertyId");--> statement-breakpoint
CREATE INDEX "ImportJobRawData_importJobId_idx" ON "ImportJobRawData" USING btree ("importJobId");--> statement-breakpoint
CREATE INDEX "ImportJobRawData_importJobId_rowIndex_idx" ON "ImportJobRawData" USING btree ("importJobId","rowIndex");--> statement-breakpoint
CREATE INDEX "ImportJobRawData_importJobId_columnIndex_idx" ON "ImportJobRawData" USING btree ("importJobId","columnIndex");--> statement-breakpoint
CREATE INDEX "ImportJobRawData_valueHash_idx" ON "ImportJobRawData" USING btree ("importJobId","columnIndex","valueHash");--> statement-breakpoint
CREATE INDEX "ImportJob_organizationId_idx" ON "ImportJob" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "ImportJob_importMappingId_idx" ON "ImportJob" USING btree ("importMappingId");--> statement-breakpoint
CREATE INDEX "ImportJob_status_idx" ON "ImportJob" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ImportJob_createdById_idx" ON "ImportJob" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "ImportMappingProperty_importMappingId_idx" ON "ImportMappingProperty" USING btree ("importMappingId");--> statement-breakpoint
CREATE INDEX "ImportMappingProperty_sourceColumnIndex_idx" ON "ImportMappingProperty" USING btree ("importMappingId","sourceColumnIndex");--> statement-breakpoint
CREATE INDEX "ImportMapping_organizationId_idx" ON "ImportMapping" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "ImportMapping_targetTable_idx" ON "ImportMapping" USING btree ("targetTable");--> statement-breakpoint
CREATE INDEX "ImportPlanRow_importPlanStrategyId_idx" ON "ImportPlanRow" USING btree ("importPlanStrategyId");--> statement-breakpoint
CREATE INDEX "ImportPlanRow_status_idx" ON "ImportPlanRow" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ImportPlanRow_strategyId_rowIndex_key" ON "ImportPlanRow" USING btree ("importPlanStrategyId","rowIndex");--> statement-breakpoint
CREATE INDEX "ImportPlanStrategy_importPlanId_idx" ON "ImportPlanStrategy" USING btree ("importPlanId");--> statement-breakpoint
CREATE INDEX "ImportPlanStrategy_strategy_idx" ON "ImportPlanStrategy" USING btree ("strategy");--> statement-breakpoint
CREATE INDEX "ImportPlan_importJobId_idx" ON "ImportPlan" USING btree ("importJobId");--> statement-breakpoint
CREATE INDEX "ImportPlan_status_idx" ON "ImportPlan" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ImportValueResolution_importJobPropertyId_idx" ON "ImportValueResolution" USING btree ("importJobPropertyId");--> statement-breakpoint
CREATE UNIQUE INDEX "ImportValueResolution_propertyId_hash_key" ON "ImportValueResolution" USING btree ("importJobPropertyId","hashedValue");--> statement-breakpoint
CREATE INDEX "ImportValueResolution_status_idx" ON "ImportValueResolution" USING btree ("importJobPropertyId","status");