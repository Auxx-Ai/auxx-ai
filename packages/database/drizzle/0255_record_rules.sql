CREATE TABLE "RecordRule" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"entityDefinitionId" text NOT NULL,
	"fieldId" text,
	"name" text NOT NULL,
	"on" text DEFAULT 'changed' NOT NULL,
	"condition" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdByUserId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RecordRuleRun" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"ruleId" text NOT NULL,
	"entityInstanceId" text NOT NULL,
	"source" text DEFAULT 'interactive' NOT NULL,
	"fieldId" text,
	"oldValue" jsonb,
	"newValue" jsonb,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"firedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "RecordRule" ADD CONSTRAINT "RecordRule_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordRule" ADD CONSTRAINT "RecordRule_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordRule" ADD CONSTRAINT "RecordRule_fieldId_CustomField_id_fk" FOREIGN KEY ("fieldId") REFERENCES "public"."CustomField"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordRule" ADD CONSTRAINT "RecordRule_createdByUserId_User_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordRuleRun" ADD CONSTRAINT "RecordRuleRun_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordRuleRun" ADD CONSTRAINT "RecordRuleRun_ruleId_RecordRule_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."RecordRule"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "RecordRule_organizationId_fieldId_idx" ON "RecordRule" USING btree ("organizationId","fieldId");--> statement-breakpoint
CREATE INDEX "RecordRule_organizationId_entityDefinitionId_idx" ON "RecordRule" USING btree ("organizationId","entityDefinitionId");--> statement-breakpoint
CREATE INDEX "RecordRuleRun_organizationId_ruleId_firedAt_idx" ON "RecordRuleRun" USING btree ("organizationId","ruleId","firedAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "RecordRuleRun_firedAt_idx" ON "RecordRuleRun" USING btree ("firedAt");