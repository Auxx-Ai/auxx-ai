CREATE TABLE "AiSuggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"entityInstanceId" text NOT NULL,
	"entityDefinitionId" text NOT NULL,
	"threadId" text,
	"ownerUserId" text,
	"bundle" jsonb NOT NULL,
	"actionCount" integer NOT NULL,
	"computedForActivityAt" timestamp (3) NOT NULL,
	"computedForLatestMessageId" text,
	"triggerSource" text NOT NULL,
	"triggerEventType" text,
	"status" text DEFAULT 'FRESH' NOT NULL,
	"outcomes" jsonb,
	"decidedById" text,
	"decidedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SuggestionDismissal" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"entityInstanceId" text NOT NULL,
	"dismissedAtActivity" timestamp (3) NOT NULL,
	"snoozeUntil" timestamp (3),
	"reason" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD COLUMN "lastSuggestionScanAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_ownerUserId_User_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_decidedById_User_id_fk" FOREIGN KEY ("decidedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SuggestionDismissal" ADD CONSTRAINT "SuggestionDismissal_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SuggestionDismissal" ADD CONSTRAINT "SuggestionDismissal_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SuggestionDismissal" ADD CONSTRAINT "SuggestionDismissal_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "AiSuggestion_org_entity_active_key" ON "AiSuggestion" USING btree ("organizationId","entityInstanceId") WHERE status = 'FRESH';--> statement-breakpoint
CREATE INDEX "AiSuggestion_org_status_idx" ON "AiSuggestion" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX "AiSuggestion_org_entity_createdAt_idx" ON "AiSuggestion" USING btree ("organizationId","entityInstanceId","createdAt");--> statement-breakpoint
CREATE INDEX "AiSuggestion_org_entityDef_status_idx" ON "AiSuggestion" USING btree ("organizationId","entityDefinitionId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "SuggestionDismissal_org_user_entity_key" ON "SuggestionDismissal" USING btree ("organizationId","userId","entityInstanceId");--> statement-breakpoint
CREATE INDEX "SuggestionDismissal_org_user_idx" ON "SuggestionDismissal" USING btree ("organizationId","userId");--> statement-breakpoint
CREATE INDEX "EntityInstance_org_def_scan_idx" ON "EntityInstance" USING btree ("organizationId","entityDefinitionId","lastActivityAt","lastSuggestionScanAt") WHERE "archivedAt" IS NULL;