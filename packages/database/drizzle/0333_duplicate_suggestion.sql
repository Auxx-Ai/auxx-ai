CREATE TABLE "DuplicateSuggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"entityDefinitionId" text NOT NULL,
	"instanceIdLow" text NOT NULL,
	"instanceIdHigh" text NOT NULL,
	"score" double precision NOT NULL,
	"band" text NOT NULL,
	"signals" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"dismissedByUserId" text,
	"dismissedAt" timestamp (3),
	"dismissedBand" text,
	"snoozeUntil" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD COLUMN "lastDuplicateScanAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "DuplicateSuggestion" ADD CONSTRAINT "DuplicateSuggestion_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DuplicateSuggestion" ADD CONSTRAINT "DuplicateSuggestion_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DuplicateSuggestion" ADD CONSTRAINT "DuplicateSuggestion_instanceIdLow_EntityInstance_id_fk" FOREIGN KEY ("instanceIdLow") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DuplicateSuggestion" ADD CONSTRAINT "DuplicateSuggestion_instanceIdHigh_EntityInstance_id_fk" FOREIGN KEY ("instanceIdHigh") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DuplicateSuggestion" ADD CONSTRAINT "DuplicateSuggestion_dismissedByUserId_User_id_fk" FOREIGN KEY ("dismissedByUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "DuplicateSuggestion_org_def_pair_key" ON "DuplicateSuggestion" USING btree ("organizationId","entityDefinitionId","instanceIdLow","instanceIdHigh");--> statement-breakpoint
CREATE INDEX "DuplicateSuggestion_org_status_score_idx" ON "DuplicateSuggestion" USING btree ("organizationId","status","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "DuplicateSuggestion_org_low_idx" ON "DuplicateSuggestion" USING btree ("organizationId","instanceIdLow");--> statement-breakpoint
CREATE INDEX "DuplicateSuggestion_org_high_idx" ON "DuplicateSuggestion" USING btree ("organizationId","instanceIdHigh");--> statement-breakpoint
CREATE INDEX "EntityInstance_org_def_dup_scan_idx" ON "EntityInstance" USING btree ("organizationId","entityDefinitionId","updatedAt","lastDuplicateScanAt") WHERE "archivedAt" IS NULL;